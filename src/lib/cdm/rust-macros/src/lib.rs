extern crate proc_macro;

use proc_macro::TokenStream;
use quote::quote;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[allow(dead_code)]
#[derive(serde::Deserialize)]
struct CdmJsonTarget {
    #[serde(rename = "asset-hub")]
    asset_hub: String,
    bulletin: String,
    registry: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum VersionSpec {
    Pinned(u64),
    Latest(#[allow(dead_code)] String),
}

#[derive(serde::Deserialize)]
struct CdmJson {
    #[allow(dead_code)]
    targets: HashMap<String, CdmJsonTarget>,
    dependencies: HashMap<String, HashMap<String, VersionSpec>>,
}

fn find_cdm_json(start: &Path) -> Option<PathBuf> {
    let mut dir = start.to_path_buf();
    loop {
        let candidate = dir.join("cdm.json");
        if candidate.exists() {
            return Some(candidate);
        }
        if !dir.pop() {
            return None;
        }
    }
}

fn derive_module_name(package_name: &str) -> String {
    package_name
        .rsplit('/')
        .next()
        .unwrap_or(package_name)
        .replace('-', "_")
}

// Matches `pvm_contract_macros::utils::to_pascal_case`: the upstream
// `abi_import!` macro applies pascal-case to the user-supplied name when
// minting the generated contract struct type, so we mirror that here to
// produce the path `<module>::<Type>` for `pvm_cdm::reference!`.
fn to_pascal_case(snake: &str) -> String {
    let mut out = String::with_capacity(snake.len());
    let mut capitalize_next = true;
    for ch in snake.chars() {
        if ch == '_' {
            capitalize_next = true;
        } else if capitalize_next {
            out.extend(ch.to_uppercase());
            capitalize_next = false;
        } else {
            out.push(ch);
        }
    }
    out
}

/// Imports a CDM-managed contract by package name.
///
/// Expands to `pvm_contract_sdk::abi_import!` with `alloc = true`, which means
/// the consuming crate must provide a `#[global_allocator]`.
#[proc_macro]
pub fn import(input: TokenStream) -> TokenStream {
    let lit: syn::LitStr = match syn::parse(input) {
        Ok(l) => l,
        Err(e) => return e.to_compile_error().into(),
    };
    let package_name = lit.value();

    // Find cdm.json
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let start = Path::new(&manifest_dir);
    let cdm_json_path = match find_cdm_json(start) {
        Some(p) => p,
        None => {
            return syn::Error::new(
                lit.span(),
                format!(
                    "cdm.json not found. Run 'cdm install' to create one. Searched from: {}",
                    manifest_dir
                ),
            )
            .to_compile_error()
            .into();
        }
    };

    // Parse cdm.json
    let content = match std::fs::read_to_string(&cdm_json_path) {
        Ok(c) => c,
        Err(e) => {
            return syn::Error::new(
                lit.span(),
                format!("Failed to read {}: {}", cdm_json_path.display(), e),
            )
            .to_compile_error()
            .into();
        }
    };
    let cdm: CdmJson = match serde_json::from_str(&content) {
        Ok(c) => c,
        Err(e) => {
            return syn::Error::new(
                lit.span(),
                format!("Failed to parse {}: {}", cdm_json_path.display(), e),
            )
            .to_compile_error()
            .into();
        }
    };

    // Find the package across all targets
    let mut found: Vec<(String, &VersionSpec)> = Vec::new();
    for (hash, deps) in &cdm.dependencies {
        if let Some(version) = deps.get(&package_name) {
            found.push((hash.clone(), version));
        }
    }

    if found.is_empty() {
        return syn::Error::new(
            lit.span(),
            format!(
                "Package '{}' not found in cdm.json dependencies. Run 'cdm install {}' first.",
                package_name, package_name
            ),
        )
        .to_compile_error()
        .into();
    }

    if found.len() > 1 {
        let hashes: Vec<&str> = found.iter().map(|(h, _)| h.as_str()).collect();
        return syn::Error::new(
            lit.span(),
            format!(
                "Package '{}' found in multiple targets: [{}]. Target disambiguation is not yet supported.",
                package_name,
                hashes.join(", ")
            ),
        )
        .to_compile_error()
        .into();
    }

    let (target_hash, version_spec) = &found[0];

    // Resolve CDM root. `CDM_ROOT` matches the override the TS side reads
    // (store.ts, accounts.ts) so both halves of the toolchain agree on
    // where contracts/ABIs live; defaults to `$HOME/.cdm` otherwise.
    let cdm_root = match std::env::var_os("CDM_ROOT") {
        Some(p) => PathBuf::from(p),
        None => match home::home_dir() {
            Some(h) => h.join(".cdm"),
            None => {
                return syn::Error::new(lit.span(), "Could not determine home directory")
                    .to_compile_error()
                    .into();
            }
        },
    };

    // Resolve version
    let version: u64 = match version_spec {
        VersionSpec::Pinned(v) => *v,
        VersionSpec::Latest(_) => {
            let latest_link = cdm_root
                .join(target_hash)
                .join("contracts")
                .join(&package_name)
                .join("latest");
            match std::fs::read_link(&latest_link) {
                Ok(target) => {
                    let version_str = target.to_string_lossy();
                    match version_str.parse::<u64>() {
                        Ok(v) => v,
                        Err(_) => {
                            return syn::Error::new(
                                lit.span(),
                                format!(
                                    "Could not parse version from latest symlink at {}. Target: {}",
                                    latest_link.display(),
                                    version_str
                                ),
                            )
                            .to_compile_error()
                            .into();
                        }
                    }
                }
                Err(e) => {
                    return syn::Error::new(
                        lit.span(),
                        format!(
                            "Could not read latest symlink at {}: {}. Run 'cdm install {}' first.",
                            latest_link.display(),
                            e,
                            package_name
                        ),
                    )
                    .to_compile_error()
                    .into();
                }
            }
        }
    };

    // Construct ABI path
    let abi_path = cdm_root
        .join(target_hash)
        .join("contracts")
        .join(&package_name)
        .join(version.to_string())
        .join("abi.json");

    if !abi_path.exists() {
        return syn::Error::new(
            lit.span(),
            format!(
                "ABI file not found at {}. Run 'cdm install {}' to download it.",
                abi_path.display(),
                package_name
            ),
        )
        .to_compile_error()
        .into();
    }

    let module_name = derive_module_name(&package_name);
    // `derive_module_name` only collapses '/' and '-'; CDM package names may
    // legally contain other characters (e.g. '.') which are not valid Rust
    // identifier code points. Validate before constructing `syn::Ident`, which
    // would otherwise panic during macro expansion instead of surfacing a
    // diagnostic at the call site.
    let module_ident = match syn::parse_str::<syn::Ident>(&module_name) {
        Ok(i) => i,
        Err(_) => {
            return syn::Error::new(
                lit.span(),
                format!(
                    "CDM package '{}' produces invalid Rust identifier '{}'; rename or use a CDM-compatible package name.",
                    package_name, module_name
                ),
            )
            .to_compile_error()
            .into();
        }
    };
    let pascal_name = to_pascal_case(&module_name);
    let contract_ident = match syn::parse_str::<syn::Ident>(&pascal_name) {
        Ok(i) => i,
        Err(_) => {
            return syn::Error::new(
                lit.span(),
                format!(
                    "CDM package '{}' produces invalid Rust identifier '{}'; rename or use a CDM-compatible package name.",
                    package_name, pascal_name
                ),
            )
            .to_compile_error()
            .into();
        }
    };
    let abi_path_str = abi_path.to_string_lossy().to_string();

    let import_module_ident = syn::Ident::new(
        &format!("__cdm_import_{}", module_name),
        proc_macro2::Span::call_site(),
    );

    quote! {
        #[doc(hidden)]
        mod #import_module_ident {
            extern crate alloc;
            pvm_contract_sdk::abi_import! {
                #![abi_import(alloc = true)]
                #module_ident,
                #abi_path_str
            }
            pvm_cdm::reference!(#module_ident::#contract_ident, #package_name);
        }
        pub use #import_module_ident::*;
    }
    .into()
}

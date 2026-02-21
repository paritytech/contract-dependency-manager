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
    registry: String,
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

    // Resolve home directory
    let home_dir = match home::home_dir() {
        Some(h) => h,
        None => {
            return syn::Error::new(lit.span(), "Could not determine home directory")
                .to_compile_error()
                .into();
        }
    };

    let cdm_root = home_dir.join(".cdm");

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
    let abi_path_str = abi_path.to_string_lossy().to_string();

    quote! {
        pvm::abi_import!(#module_name, #abi_path_str, cdm = #package_name);
    }
    .into()
}

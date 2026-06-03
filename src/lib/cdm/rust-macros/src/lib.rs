extern crate proc_macro;

use proc_macro::TokenStream;
use quote::quote;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(serde::Deserialize)]
struct CdmJsonContract {
    version: u64,
    abi: serde_json::Value,
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum VersionSpec {
    Pinned(#[allow(dead_code)] u64),
    Latest(#[allow(dead_code)] String),
}

#[derive(serde::Deserialize)]
struct CdmJson {
    #[allow(dead_code)]
    dependencies: HashMap<String, VersionSpec>,
    contracts: Option<HashMap<String, CdmJsonContract>>,
}

#[derive(serde::Deserialize)]
struct CargoMetadata {
    packages: Vec<CargoPackage>,
    workspace_members: Vec<String>,
    workspace_root: PathBuf,
    target_directory: PathBuf,
}

#[derive(serde::Deserialize)]
struct CargoPackage {
    id: String,
    name: String,
    manifest_path: PathBuf,
    #[serde(default)]
    metadata: serde_json::Value,
    targets: Vec<CargoTarget>,
}

#[derive(serde::Deserialize)]
struct CargoTarget {
    name: String,
    kind: Vec<String>,
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

fn cdm_package_from_cargo_metadata(metadata: &serde_json::Value) -> Option<&str> {
    let cdm = metadata.get("cdm")?.as_object()?;
    cdm.get("package")
        .or_else(|| cdm.get("name"))
        .and_then(|value| value.as_str())
}

fn load_cargo_metadata(manifest_dir: &Path) -> Result<CargoMetadata, String> {
    let manifest_path = manifest_dir.join("Cargo.toml");
    let output = Command::new("cargo")
        .arg("metadata")
        .arg("--format-version")
        .arg("1")
        .arg("--manifest-path")
        .arg(&manifest_path)
        .arg("--no-deps")
        .current_dir(manifest_dir)
        .output()
        .map_err(|e| format!("Failed to invoke `cargo metadata`: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "`cargo metadata` failed for {}:\n{}",
            manifest_path.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse `cargo metadata` output: {}", e))
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    if !values.iter().any(|existing| existing == value) {
        values.push(value.to_string());
    }
}

fn push_unique_path(values: &mut Vec<PathBuf>, value: PathBuf) {
    if !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

fn abi_path_candidates(target_dirs: &[PathBuf], package: &CargoPackage) -> Vec<PathBuf> {
    let mut names = Vec::new();
    for target in package
        .targets
        .iter()
        .filter(|target| target.kind.iter().any(|kind| kind == "bin"))
    {
        push_unique(&mut names, &target.name);
        push_unique(&mut names, &target.name.replace('-', "_"));
    }
    push_unique(&mut names, &package.name);
    push_unique(&mut names, &package.name.replace('-', "_"));

    let mut candidates = Vec::new();
    for target_dir in target_dirs {
        for name in &names {
            for profile in ["release", "debug"] {
                candidates.push(target_dir.join(profile).join(format!("{}.abi.json", name)));
                candidates.push(target_dir.join(format!("{}.{}.abi.json", name, profile)));
            }
            candidates.push(target_dir.join(format!("{}.abi.json", name)));
        }
    }
    candidates
}

fn materialize_abi_import_file(
    package_name: &str,
    artifact_path: &Path,
    project_root: &Path,
) -> Result<PathBuf, String> {
    let content = std::fs::read_to_string(artifact_path)
        .map_err(|e| format!("Failed to read {}: {}", artifact_path.display(), e))?;
    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", artifact_path.display(), e))?;

    let abi = match &value {
        serde_json::Value::Array(_) => return Ok(artifact_path.to_path_buf()),
        serde_json::Value::Object(object) => object.get("abi").ok_or_else(|| {
            format!(
                "Local ABI artifact {} is an object but does not contain an `abi` field",
                artifact_path.display()
            )
        })?,
        _ => {
            return Err(format!(
                "Local ABI artifact {} must be an ABI array or object with an `abi` field",
                artifact_path.display()
            ));
        }
    };

    if !abi.is_array() {
        return Err(format!(
            "Local ABI artifact {} has a non-array `abi` field",
            artifact_path.display()
        ));
    }

    let abi_path = project_root
        .join(".cdm")
        .join("local")
        .join("contracts")
        .join(package_name)
        .join("abi.json");
    let parent = abi_path.parent().ok_or_else(|| {
        format!(
            "Could not determine parent directory for {}",
            abi_path.display()
        )
    })?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    let bytes = serde_json::to_vec_pretty(abi).map_err(|e| {
        format!(
            "Failed to serialize local ABI for '{}': {}",
            package_name, e
        )
    })?;
    std::fs::write(&abi_path, bytes)
        .map_err(|e| format!("Failed to write {}: {}", abi_path.display(), e))?;
    Ok(abi_path)
}

fn resolve_local_abi(package_name: &str, manifest_dir: &Path) -> Result<Option<PathBuf>, String> {
    let metadata = load_cargo_metadata(manifest_dir)?;
    let workspace_members: HashSet<&str> = metadata
        .workspace_members
        .iter()
        .map(|member| member.as_str())
        .collect();

    let matches: Vec<&CargoPackage> = metadata
        .packages
        .iter()
        .filter(|package| workspace_members.contains(package.id.as_str()))
        .filter(|package| cdm_package_from_cargo_metadata(&package.metadata) == Some(package_name))
        .collect();

    match matches.as_slice() {
        [] => Ok(None),
        [package] => {
            let mut target_dirs = Vec::new();
            push_unique_path(&mut target_dirs, metadata.target_directory.clone());
            push_unique_path(&mut target_dirs, metadata.workspace_root.join("target"));

            if let Some(cdm_json_path) = find_cdm_json(manifest_dir) {
                if let Some(project_root) = cdm_json_path.parent() {
                    push_unique_path(&mut target_dirs, project_root.join("target"));
                }
            }

            let candidates = abi_path_candidates(&target_dirs, package);
            let project_root = find_cdm_json(manifest_dir)
                .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
                .unwrap_or_else(|| metadata.workspace_root.clone());

            if let Some(path) = candidates.iter().find(|path| path.exists()) {
                return materialize_abi_import_file(package_name, path, &project_root).map(Some);
            }

            let searched = candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join("\n  ");
            Err(format!(
                "Found local CDM package '{}' in {}, but no ABI artifact was found.\n\
                 Build the dependency first with `cdm build` or `cargo pvm-contract build --manifest-path {} -p {}`.\n\
                 Searched:\n  {}",
                package_name,
                package.manifest_path.display(),
                manifest_dir.join("Cargo.toml").display(),
                package.name,
                searched
            ))
        }
        _ => {
            let manifests = matches
                .iter()
                .map(|package| package.manifest_path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            Err(format!(
                "CDM package '{}' is declared by multiple workspace members: {}",
                package_name, manifests
            ))
        }
    }
}

fn resolve_installed_abi(
    package_name: &str,
    start: &Path,
    manifest_dir: &str,
) -> Result<PathBuf, String> {
    let cdm_json_path = find_cdm_json(start).ok_or_else(|| {
        format!(
            "cdm.json not found. Run 'cdm install' to create one. Searched from: {}",
            manifest_dir
        )
    })?;

    let content = std::fs::read_to_string(&cdm_json_path)
        .map_err(|e| format!("Failed to read {}: {}", cdm_json_path.display(), e))?;
    let cdm: CdmJson = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", cdm_json_path.display(), e))?;

    if !cdm.dependencies.contains_key(package_name) {
        return Err(format!(
            "Package '{}' not found in cdm.json dependencies. Run 'cdm install {}' first.",
            package_name, package_name
        ));
    }

    let contracts = cdm.contracts.as_ref().ok_or_else(|| {
        format!(
            "No contracts found in cdm.json. Run 'cdm install {}' first.",
            package_name
        )
    })?;
    let contract = contracts.get(package_name).ok_or_else(|| {
        format!(
            "Package '{}' has no installed contract data in cdm.json. Run 'cdm install {}' first.",
            package_name, package_name
        )
    })?;

    let cdm_root = cdm_json_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(".cdm");
    let abi_path = cdm_root
        .join("contracts")
        .join(package_name)
        .join(contract.version.to_string())
        .join("abi.json");

    if !abi_path.exists() {
        let parent = abi_path.parent().ok_or_else(|| {
            format!(
                "Could not determine parent directory for {}",
                abi_path.display()
            )
        })?;
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
        let abi = serde_json::to_vec_pretty(&contract.abi)
            .map_err(|e| format!("Failed to serialize ABI for '{}': {}", package_name, e))?;
        std::fs::write(&abi_path, abi)
            .map_err(|e| format!("Failed to write {}: {}", abi_path.display(), e))?;
    };

    if !abi_path.exists() {
        return Err(format!(
            "ABI file not found at {}. Run 'cdm install {}' to download it.",
            abi_path.display(),
            package_name
        ));
    }

    Ok(abi_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cdm_package_prefers_package_key_and_accepts_legacy_name() {
        let current = json!({
            "cdm": {
                "package": "@test/current",
                "name": "@test/legacy"
            }
        });
        let legacy = json!({
            "cdm": {
                "name": "@test/legacy"
            }
        });

        assert_eq!(
            cdm_package_from_cargo_metadata(&current),
            Some("@test/current")
        );
        assert_eq!(
            cdm_package_from_cargo_metadata(&legacy),
            Some("@test/legacy")
        );
    }

    #[test]
    fn abi_candidates_cover_new_and_legacy_cargo_pvm_contract_layouts() {
        let package = CargoPackage {
            id: "path+file:///workspace/provider#counter-reader@0.1.0".to_string(),
            name: "counter-reader".to_string(),
            manifest_path: PathBuf::from("/workspace/provider/Cargo.toml"),
            metadata: json!({}),
            targets: vec![CargoTarget {
                name: "counter-reader".to_string(),
                kind: vec!["bin".to_string()],
            }],
        };

        let candidates = abi_path_candidates(&[PathBuf::from("/workspace/target")], &package);
        assert!(candidates.contains(&PathBuf::from(
            "/workspace/target/release/counter-reader.abi.json"
        )));
        assert!(candidates.contains(&PathBuf::from(
            "/workspace/target/release/counter_reader.abi.json"
        )));
        assert!(candidates.contains(&PathBuf::from(
            "/workspace/target/counter-reader.release.abi.json"
        )));
    }

    #[test]
    fn materializes_wrapped_cargo_pvm_contract_abi_as_sequence() {
        let root = std::env::temp_dir().join(format!("cdm-macro-abi-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let artifact = root.join("counter.abi.json");
        std::fs::write(
            &artifact,
            r#"{"abi":[{"type":"function","name":"getCount","inputs":[],"outputs":[]}],"storageLayout":{"storage":[]}}"#,
        )
        .unwrap();

        let abi_path = materialize_abi_import_file("@example/counter", &artifact, &root).unwrap();
        let content = std::fs::read_to_string(&abi_path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&content).unwrap();

        assert!(value.is_array());
        assert_eq!(
            abi_path,
            root.join(".cdm")
                .join("local")
                .join("contracts")
                .join("@example/counter")
                .join("abi.json")
        );

        std::fs::remove_dir_all(root).unwrap();
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

    // Prefer workspace-local CDM packages, then fall back to installed ABIs.
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let start = Path::new(&manifest_dir);
    let abi_path = match resolve_local_abi(&package_name, start) {
        Ok(Some(path)) => path,
        Ok(None) => match resolve_installed_abi(&package_name, start, &manifest_dir) {
            Ok(path) => path,
            Err(e) => return syn::Error::new(lit.span(), e).to_compile_error().into(),
        },
        Err(e) => return syn::Error::new(lit.span(), e).to_compile_error().into(),
    };

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

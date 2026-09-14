//! CDM contract-name validation.
//!
//! A valid name is ASCII of the form `@scope/package`: a single `@`-prefixed
//! scope and a package part separated by exactly one `/`, both non-empty and
//! limited to alphanumerics, `-`, and `_`.

/// Longest accepted contract name in bytes.
pub const MAX_CONTRACT_NAME_LEN: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameError {
    Empty,
    TooLong,
    Invalid,
}

pub fn validate_contract_name(name: &str) -> Result<(), NameError> {
    if name.is_empty() {
        return Err(NameError::Empty);
    }
    let bytes = name.as_bytes();
    if bytes.len() > MAX_CONTRACT_NAME_LEN {
        return Err(NameError::TooLong);
    }
    if !name.is_ascii() || bytes[0] != b'@' {
        return Err(NameError::Invalid);
    }

    let mut slash_idx: Option<usize> = None;
    for (idx, byte) in bytes.iter().copied().enumerate().skip(1) {
        if byte == b'/' {
            if slash_idx.is_some() {
                return Err(NameError::Invalid);
            }
            slash_idx = Some(idx);
        } else if !is_package_name_char(byte) {
            return Err(NameError::Invalid);
        }
    }

    match slash_idx {
        // Non-empty scope (`@x` before the slash) and non-empty package after.
        Some(idx) if idx > 1 && idx + 1 < bytes.len() => Ok(()),
        _ => Err(NameError::Invalid),
    }
}

fn is_package_name_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_well_formed_names() {
        for name in [
            "@cdm/registry",
            "@a1/b2",
            "@my-scope/my_package",
            "@x0/y-1_z",
        ] {
            assert_eq!(validate_contract_name(name), Ok(()), "{name}");
        }
    }

    #[test]
    fn rejects_empty() {
        assert_eq!(validate_contract_name(""), Err(NameError::Empty));
    }

    #[test]
    fn rejects_too_long() {
        let name = format!("@scope/{}", "a".repeat(MAX_CONTRACT_NAME_LEN));
        assert_eq!(validate_contract_name(&name), Err(NameError::TooLong));
    }

    #[test]
    fn boundary_length_is_accepted() {
        let name = format!("@scope/{}", "a".repeat(MAX_CONTRACT_NAME_LEN - 7));
        assert_eq!(name.len(), MAX_CONTRACT_NAME_LEN);
        assert_eq!(validate_contract_name(&name), Ok(()));
    }

    #[test]
    fn rejects_malformed_names() {
        for name in [
            "cdm/registry",   // missing @
            "@/registry",     // empty scope
            "@cdm/",          // empty package
            "@cdm",           // no slash
            "@cdm/a/b",       // two slashes
            "@cdm/reg istry", // whitespace
            "@cdm/reg.istry", // dot
            "@cdm/régistry",  // non-ascii
            "@CDM/REGISTRY!", // punctuation
        ] {
            assert_eq!(
                validate_contract_name(name),
                Err(NameError::Invalid),
                "{name}"
            );
        }
    }

    #[test]
    fn uppercase_and_digits_are_valid_package_chars() {
        assert_eq!(validate_contract_name("@Scope9/Pkg_2"), Ok(()));
    }
}

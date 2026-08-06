//! At-rest encryption for the file-backed gateway credential store.
//!
//! Windows: the plaintext JSON is encrypted with DPAPI (`CryptProtectData`),
//! which binds the blob to the current Windows user and machine, so even with
//! default ACLs the file is unreadable without the user's session. Unix keeps
//! plaintext but relies on the owner-only 0700/0600 permissions applied by
//! `persist_creds_to_file` (the Linux keyring convention is plaintext key
//! files too). This closes the "credentials at rest are readable by any
//! process with the same OS user" gap on Windows.

/// Encrypt `plain` for at-rest storage. Returns bytes to write to disk.
/// On Unix this is a no-op passthrough (owner-only perms are the protection).
pub fn encrypt(plain: &[u8]) -> Vec<u8> {
    #[cfg(target_os = "windows")]
    {
        dpapi::protect(plain)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = plain;
        plain.to_vec()
    }
}

/// Decrypt `cipher` previously produced by [`encrypt`]. Returns the plaintext
/// bytes, or `None` if the blob can't be decrypted (wrong user / tampered).
pub fn decrypt(cipher: &[u8]) -> Option<Vec<u8>> {
    #[cfg(target_os = "windows")]
    {
        dpapi::unprotect(cipher)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = cipher;
        Some(cipher.to_vec())
    }
}

#[cfg(target_os = "windows")]
mod dpapi {
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    use windows_sys::Win32::Foundation::LocalFree;

    /// DPAPI-encrypt `plain`, scoped to the current user + machine.
    pub fn protect(plain: &[u8]) -> Vec<u8> {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &in_blob,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        };
        if ok == 0 {
            return plain.to_vec(); // best-effort: fall back to plaintext on failure
        }
        let bytes = unsafe {
            std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec()
        };
        unsafe {
            LocalFree(out_blob.pbData as _);
        }
        bytes
    }

    /// DPAPI-decrypt `cipher`. Returns `None` if it isn't a valid DPAPI blob
    /// (e.g. plaintext written before encryption was introduced, or another
    /// user's blob).
    pub fn unprotect(cipher: &[u8]) -> Option<Vec<u8>> {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: cipher.len() as u32,
            pbData: cipher.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let ok = unsafe {
            CryptUnprotectData(
                &in_blob,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        };
        if ok == 0 || out_blob.pbData.is_null() {
            return None;
        }
        let bytes = unsafe {
            std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec()
        };
        unsafe {
            LocalFree(out_blob.pbData as _);
        }
        Some(bytes)
    }
}

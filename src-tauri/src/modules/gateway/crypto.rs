//! Crypto helpers shared by the platform adapters:
//! - AES-128-CBC (WeCom / Official Account callback body encryption)
//! - AES-128-ECB (WeChat iLink CDN media)
//! - HMAC-SHA256 / SHA-1 signature verification (callback auth)
//!
//! Mirrors  `wecom_crypto.py` and `weixin.py` helpers.

use aes::cipher::{
    block_padding::Pkcs7, BlockDecrypt, BlockDecryptMut, BlockEncrypt, BlockEncryptMut, KeyInit,
    KeyIvInit,
};
use hmac::{Hmac, Mac};

type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;
type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

/// PKCS#7 pad a byte slice to a full 16-byte block.
pub fn pkcs7_pad(data: &[u8], block_size: usize) -> Vec<u8> {
    let pad_len = block_size - (data.len() % block_size);
    let mut out = data.to_vec();
    out.extend(std::iter::repeat_n(pad_len as u8, pad_len));
    out
}

/// AES-128-CBC encrypt with PKCS#7 padding (default iv of zeros unless given).
pub fn aes128_cbc_encrypt(key: &[u8], iv: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 16 || iv.len() != 16 {
        return Err("aes128_cbc: key and iv must be 16 bytes".into());
    }
    let enc = Aes128CbcEnc::new(key.into(), iv.into());
    let ciphertext = enc
        .encrypt_padded_vec_mut::<Pkcs7>(plaintext);
    Ok(ciphertext)
}

/// AES-128-CBC decrypt with PKCS#7 unpadding.
pub fn aes128_cbc_decrypt(key: &[u8], iv: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 16 || iv.len() != 16 {
        return Err("aes128_cbc: key and iv must be 16 bytes".into());
    }
    let dec = Aes128CbcDec::new(key.into(), iv.into());
    dec.decrypt_padded_vec_mut::<Pkcs7>(ciphertext)
        .map_err(|e| format!("aes128_cbc_decrypt failed: {e}"))
}

// --- WeChat iLink CDN media (AES-128-ECB + PKCS7) ---------------------------

/// AES-128-ECB encrypt with PKCS#7 padding (manual block loop).
pub fn aes128_ecb_encrypt(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 16 {
        return Err("aes128_ecb: key must be 16 bytes".into());
    }
    let padded = pkcs7_pad(plaintext, 16);
    let cipher = aes::Aes128::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(padded.len());
    for block in padded.chunks_exact(16) {
        let mut buf = *<&[u8; 16]>::try_from(block).map_err(|_| "ecb block")?;
        cipher.encrypt_block((&mut buf).into());
        out.extend_from_slice(&buf);
    }
    Ok(out)
}

/// AES-128-ECB decrypt + PKCS#7 unpad.
pub fn aes128_ecb_decrypt(key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 16 {
        return Err("aes128_ecb: key must be 16 bytes".into());
    }
    if !ciphertext.len().is_multiple_of(16) {
        return Err("aes128_ecb: ciphertext length not a multiple of 16".into());
    }
    let cipher = aes::Aes128::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(ciphertext.len());
    for block in ciphertext.chunks_exact(16) {
        let mut buf = *<&[u8; 16]>::try_from(block).map_err(|_| "ecb block")?;
        cipher.decrypt_block((&mut buf).into());
        out.extend_from_slice(&buf);
    }
    let pad_len = *out.last().unwrap_or(&0) as usize;
    if pad_len == 0 || pad_len > 16 {
        return Err("aes128_ecb: bad pkcs7 padding".into());
    }
    out.truncate(out.len() - pad_len);
    Ok(out)
}

// --- Signature verification -------------------------------------------------

/// HMAC-SHA256 hex digest (WeCom / generic callback signing).
pub fn hmac_sha256_hex(key: &[u8], message: &[u8]) -> String {
    let mut mac = <Hmac<sha2::Sha256> as Mac>::new_from_slice(key)
        .expect("hmac accepts any key length");
    mac.update(message);
    hex::encode(mac.finalize().into_bytes())
}

/// SHA-1 hex digest (WeChat Official Account callback signature).
pub fn sha1_hex(data: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    let mut h = Sha1::new();
    h.update(data);
    hex::encode(h.finalize())
}

/// Constant-time hex comparison for callback signatures.
///
/// Runs a fixed-length loop over the longer input and folds the length
/// difference into the accumulator, so the time taken does not reveal how many
/// leading bytes matched (or even whether the lengths differ).
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    let max = a.len().max(b.len());
    let mut diff = (a.len() as u8) ^ (b.len() as u8);
    for i in 0..max {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aes_cbc_roundtrip() {
        let key = b"0123456789abcdef";
        let iv = b"fedcba9876543210";
        let plain = b"hello yamet gateway crypto roundtrip payload";
        let ct = aes128_cbc_encrypt(key, iv, plain).unwrap();
        let pt = aes128_cbc_decrypt(key, iv, &ct).unwrap();
        assert_eq!(pt, plain);
    }

    #[test]
    fn aes_cbc_wrong_key_does_not_roundtrip() {
        let k1 = b"0123456789abcdef";
        let k2 = b"abcdef0123456789";
        let iv = b"fedcba9876543210";
        let ct = aes128_cbc_encrypt(k1, iv, b"secret data").unwrap();
        let pt = aes128_cbc_decrypt(k2, iv, &ct);
        // Must not silently produce the original plaintext.
        assert!(pt.is_err() || pt.unwrap_or_default() != b"secret data");
    }

    #[test]
    fn aes_ecb_roundtrip() {
        let key = b"0123456789abcdef";
        let plain = b"aes ecb roundtrip payload for iLink cdn";
        let ct = aes128_ecb_encrypt(key, plain).unwrap();
        let pt = aes128_ecb_decrypt(key, &ct).unwrap();
        assert_eq!(pt, plain);
    }

    #[test]
    fn pkcs7_pad_adds_full_block_on_alignment() {
        let padded = pkcs7_pad(b"1234567890123456", 16); // exactly one block
        assert_eq!(padded.len(), 32); // adds a full 16-byte padding block
        assert_eq!(padded[16], 16);
    }

    #[test]
    fn sha1_known_vector() {
        assert_eq!(
            sha1_hex(b"abc"),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
    }

    #[test]
    fn hmac_sha256_rfc4231_case1() {
        let key = [0x0b_u8; 20];
        let msg = b"Hi There";
        assert_eq!(
            hmac_sha256_hex(&key, msg),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn constant_time_eq_compares_content_not_length_only() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
    }
}

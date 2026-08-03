//! Crypto helpers shared by the platform adapters:
//! - AES-128-CBC (WeCom / Official Account callback body encryption)
//! - AES-128-ECB (WeChat iLink CDN media)
//! - HMAC-SHA256 / SHA-1 signature verification (callback auth)
//!
//! Mirrors Hermes `wecom_crypto.py` and `weixin.py` helpers.

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
    out.extend(std::iter::repeat(pad_len as u8).take(pad_len));
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
    if ciphertext.len() % 16 != 0 {
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

/// Constant-time-ish hex comparison for callback signatures.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    a.as_bytes().len() == b.as_bytes().len() && a.as_bytes().iter().zip(b.as_bytes()).all(|(x, y)| x == y)
}

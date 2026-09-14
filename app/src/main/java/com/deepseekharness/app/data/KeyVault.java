package com.deepseekharness.app.data;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * API Key 的加密存储：Android Keystore + AES/GCM，密钥不出 Keystore。
 *
 * <p>原版内联在 {@code HarnessController} 的 getOrCreateKey/encryptKey/decryptKey 里，
 * 这里独立成 {@code data} 层的一个类，让「凭据怎么加密」有单一归属，也能被单测
 * 之外的地方复用。IV 前置、Base64(NO_WRAP) 编码，与历史存储格式保持一致。
 */
public class KeyVault {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "dsh_api_key";
    private static final int GCM_TAG_BITS = 128;
    private static final int IV_BYTES = 12;

    private final Context ctx;

    public KeyVault(Context ctx) {
        this.ctx = ctx;
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        kg.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return kg.generateKey();
    }

    /** 加密。失败返回空串（宁可丢一次写入，也不要明文落盘）。 */
    public String encrypt(String plain) {
        if (plain == null || plain.isEmpty()) return "";
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] iv = c.getIV();
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return Base64.encodeToString(out, Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    /** 解密。失败返回空串。 */
    public String decrypt(String stored) {
        if (stored == null || stored.isEmpty()) return "";
        try {
            byte[] all = Base64.decode(stored, Base64.NO_WRAP);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, getOrCreateKey(),
                    new GCMParameterSpec(GCM_TAG_BITS, all, 0, IV_BYTES));
            byte[] pt = c.doFinal(all, IV_BYTES, all.length - IV_BYTES);
            return new String(pt, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }
}

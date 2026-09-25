import java.io.*;
import java.nio.file.*;
import java.util.zip.*;

/** 复刻 TarGzipExtractor 的解压逻辑（纯 JDK，去掉 Android Os/Compat），定位失败条目。 */
public class TarRepro {
    static int BLOCK = 512;

    public static void main(String[] args) throws Exception {
        String src = args[0];
        File dest = new File(args[1]);
        try (InputStream raw = new FileInputStream(src)) {
            PushbackInputStream pin = new PushbackInputStream(new BufferedInputStream(raw, 1 << 16), 2);
            int b0 = pin.read(), b1 = pin.read();
            if (b0 >= 0) {
                if (b1 >= 0) pin.unread(new byte[]{(byte) b0, (byte) b1});
                else pin.unread(b0);
            }
            InputStream in = (b0 == 0x1f && b1 == 0x8b)
                    ? new GZIPInputStream(pin, 1 << 16) : pin;
            extractTar(in, dest);
        }
    }

    static void extractTar(InputStream in, File dest) throws IOException {
        BufferedInputStream bin = new BufferedInputStream(in, 1 << 16);
        byte[] header = new byte[BLOCK];
        byte[] buf = new byte[1 << 18];
        long total = 0;
        while (true) {
            if (!readFull(bin, header, BLOCK)) break;
            if (isZero(header)) {
                if (!readFull(bin, header, BLOCK)) break;
                if (isZero(header)) break;
                continue;
            }
            String name = parseStr(header, 0, 100);
            long size = parseOct(header, 124, 12);
            int mode = (int) parseOct(header, 100, 8);
            int type = header[156] & 0xFF;
            String linkname = parseStr(header, 157, 100);
            if (type == 'L' || type == 'x' || type == 'K') {
                byte[] ld = new byte[(int) size];
                readFull(bin, ld, ld.length);
                skipPad(bin, size);
                if (type == 'L') name = new String(ld, "UTF-8").trim();
                continue;
            }
            String prefix = parseStr(header, 345, 155);
            if (prefix != null && !prefix.isEmpty()) name = prefix + "/" + name;
            File out = new File(dest, name);
            switch (type) {
                case '0': case 0: case '7':
                    if (out.getParentFile() != null) out.getParentFile().mkdirs();
                    try (FileOutputStream fos = new FileOutputStream(out)) {
                        long left = size;
                        while (left > 0) {
                            int n = bin.read(buf, 0, (int) Math.min(buf.length, left));
                            if (n < 0) throw new IOException("tar 数据意外结束");
                            fos.write(buf, 0, n);
                            left -= n;
                        }
                    }
                    skipPad(bin, size);
                    total++;
                    break;
                case '5':
                    out.mkdirs();
                    skipPad(bin, size);
                    break;
                case '2':
                    if (out.getParentFile() != null) out.getParentFile().mkdirs();
                    // 只创建相对安全链接（模拟 safeSymlinkTarget 的宽松判定）
                    if (linkname != null && !linkname.isEmpty() && !linkname.startsWith("/")) {
                        try { Files.createSymbolicLink(out.toPath(), Paths.get(linkname)); } catch (Throwable t) { }
                    }
                    skipPad(bin, size);
                    break;
                default:
                    skipPad(bin, size);
                    break;
            }
            if (total % 30000 == 0) System.out.println("  处理 " + total + " 条: " + name.substring(Math.max(0,name.length()-60)));
        }
        System.out.println("解压完成，共处理条目");
    }

    static boolean readFull(InputStream in, byte[] b, int len) throws IOException {
        int off = 0;
        while (off < len) {
            int n = in.read(b, off, len - off);
            if (n < 0) return off == 0 ? false : throwEof(len, off);
            off += n;
        }
        return true;
    }
    static boolean throwEof(int len, int off) throws IOException {
        throw new IOException("tar 数据意外结束（需要 " + len + " 只读到 " + off + "）");
    }
    static void skipPad(InputStream in, long size) throws IOException {
        long pad = (BLOCK - (size % BLOCK)) % BLOCK;
        long left = pad;
        while (left > 0) {
            long s = in.skip(left);
            if (s <= 0) { if (in.read() < 0) return; left--; }
            else left -= s;
        }
    }
    static boolean isZero(byte[] b) { for (byte x : b) if (x != 0) return false; return true; }
    static String parseStr(byte[] b, int off, int len) {
        int e = off;
        while (e < off + len && b[e] != 0) e++;
        return new String(b, off, e - off, java.nio.charset.StandardCharsets.UTF_8);
    }
    static long parseOct(byte[] b, int off, int len) {
        long v = 0;
        for (int i = off; i < off + len; i++) {
            byte c = b[i];
            if (c == 0 || c == ' ') continue;
            if (c < '0' || c > '7') break;
            v = v * 8 + (c - '0');
        }
        return v;
    }
}

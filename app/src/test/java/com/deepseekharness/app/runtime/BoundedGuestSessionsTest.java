package com.deepseekharness.app.runtime;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import com.deepseekharness.app.backup.JvmBackupFileSystem;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class BoundedGuestSessionsTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test public void inProcessCommandIsIgnoredButUncertainRecordBlocksStartup() throws Exception {
        File files = temporary.newFolder("files");
        JvmBackupFileSystem fs = new JvmBackupFileSystem();
        BoundedGuestSessions.Operation operation = BoundedGuestSessions.begin(fs, files);
        assertNull(BoundedGuestSessions.firstPending(fs, files));
        operation.uncertain();
        assertNotNull(BoundedGuestSessions.firstPending(fs, files));
    }

    @Test public void unknownRecordMemberCannotBeSilentlyRetired() throws Exception {
        File files = temporary.newFolder("files");
        JvmBackupFileSystem fs = new JvmBackupFileSystem();
        BoundedGuestSessions.Operation operation = BoundedGuestSessions.begin(fs, files);
        operation.uncertain();
        String id = BoundedGuestSessions.firstPending(fs, files);
        File entry = new File(new File(files, "bounded-guest-active"), id);
        fs.create(new File(entry, "unexpected")).close();
        assertThrows(IOException.class, () -> BoundedGuestSessions.reapExited(fs, files));
    }

    @Test public void interruptedIntentPublicationBeforeHandshakeCanBeReaped() throws Exception {
        File files = temporary.newFolder("files");
        JvmBackupFileSystem fs = new JvmBackupFileSystem();
        File home = new File(files, "bounded-guest-active"); fs.directory(home);
        String id = UUID.randomUUID().toString();
        File entry = new File(home, id); fs.directory(entry);
        write(fs, new File(entry, "intent.tmp-" + UUID.randomUUID()), id.substring(0, 12));
        assertNotNull(BoundedGuestSessions.firstPending(fs, files));
        BoundedGuestSessions.reapExited(fs, files);
        assertNull(BoundedGuestSessions.firstPending(fs, files));
    }

    @Test public void interruptedIdentityPublicationBeforeHandshakeCanBeReaped() throws Exception {
        File files = temporary.newFolder("files");
        JvmBackupFileSystem fs = new JvmBackupFileSystem();
        BoundedGuestSessions.Operation operation = BoundedGuestSessions.begin(fs, files);
        operation.uncertain();
        String id = BoundedGuestSessions.firstPending(fs, files);
        File entry = new File(new File(files, "bounded-guest-active"), id);
        write(fs, new File(entry, "identity.tmp-" + UUID.randomUUID()), id + "\n123 456 ");
        BoundedGuestSessions.reapExited(fs, files);
        assertNull(BoundedGuestSessions.firstPending(fs, files));
    }

    @Test public void cleanupInterruptedAfterIdentityUnlinkRetiresOnlyKnownMembers() throws Exception {
        File files = temporary.newFolder("files");
        JvmBackupFileSystem fs = new JvmBackupFileSystem();
        BoundedGuestSessions.Operation operation = BoundedGuestSessions.begin(fs, files);
        operation.uncertain();
        String id = BoundedGuestSessions.firstPending(fs, files);
        File entry = new File(new File(files, "bounded-guest-active"), id);
        File identity = new File(entry, "identity");
        write(fs, identity, id + "\n123 456 123\n");
        fs.delete(identity); // The group was already confirmed gone before cleanup began.
        write(fs, new File(entry, "identity.tmp-" + UUID.randomUUID()), id + "\n123 ");
        BoundedGuestSessions.reapExited(fs, files);
        assertNull(BoundedGuestSessions.firstPending(fs, files));
    }

    @Test public void nonFileInKnownTemporarySlotStillBlocksRecovery() throws Exception {
        File files = temporary.newFolder("files");
        JvmBackupFileSystem fs = new JvmBackupFileSystem();
        BoundedGuestSessions.Operation operation = BoundedGuestSessions.begin(fs, files);
        operation.uncertain();
        String id = BoundedGuestSessions.firstPending(fs, files);
        File entry = new File(new File(files, "bounded-guest-active"), id);
        fs.directory(new File(entry, "identity.tmp-" + UUID.randomUUID()));
        assertThrows(IOException.class, () -> BoundedGuestSessions.reapExited(fs, files));
    }

    private static void write(JvmBackupFileSystem fs, File file, String value) throws IOException {
        try (var out = fs.create(file)) { out.write(value.getBytes(StandardCharsets.US_ASCII)); }
    }
}

package com.deepseekharness.app.ui;

import android.os.Bundle;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.lifecycle.ViewModelProvider;
import com.deepseekharness.app.R;
import com.deepseekharness.app.core.DiagnosticRepository;

public final class DiagnosticActivity extends AppCompatActivity {
    private DiagnosticRepository repository;
    private com.deepseekharness.app.core.ErrorLogRepository logs;
    public static android.content.Intent downloadLogs(android.content.Context context) {
        return new android.content.Intent(context, DiagnosticActivity.class).putExtra("download_error_logs", true);
    }
    private final ActivityResultLauncher<String> logExporter = registerForActivityResult(new ActivityResultContracts.CreateDocument("text/plain"), uri -> {
        if (uri != null) logs.export(uri);
    });
    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved); setContentView(R.layout.activity_diagnostics);
        repository = new ViewModelProvider(this).get(DiagnosticRepository.class);
        logs = new ViewModelProvider(this).get(com.deepseekharness.app.core.ErrorLogRepository.class);
        findViewById(R.id.diagnostic_logs_download).setOnClickListener(v -> logs.download());
        findViewById(R.id.diagnostic_logs_save_as).setOnClickListener(v -> {
            try { logExporter.launch(com.deepseekharness.app.core.ErrorLogRepository.filename()); }
            catch (RuntimeException error) { Toast.makeText(this, "无法打开文件管理器，请尝试下载到默认目录", Toast.LENGTH_LONG).show(); }
        });
        logs.state.observe(this, state -> {
            ((TextView) findViewById(R.id.diagnostic_logs_status)).setText(state.message);
            findViewById(R.id.diagnostic_logs_download).setEnabled(!state.busy);
            findViewById(R.id.diagnostic_logs_save_as).setEnabled(!state.busy);
            findViewById(R.id.diagnostic_logs_status).setEnabled(!state.busy && state.uri != null);
        });
        findViewById(R.id.diagnostic_logs_status).setOnClickListener(v -> {
            com.deepseekharness.app.core.ErrorLogRepository.State state = logs.state.getValue();
            if (state == null || state.uri == null || state.busy) return;
            try {
                android.net.Uri uri = state.uri;
                if ("file".equals(uri.getScheme())) uri = androidx.core.content.FileProvider.getUriForFile(this, getPackageName() + ".updates", new java.io.File(uri.getPath()));
                startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW).setDataAndType(uri, "text/plain").addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION));
            } catch (RuntimeException error) { Toast.makeText(this, "无法打开日志，可在文件管理器的 Download/DeepSeekHarness 中查看，或重新下载", Toast.LENGTH_LONG).show(); }
        });
        findViewById(R.id.diagnostic_back).setOnClickListener(v -> finish());
        findViewById(R.id.diagnostic_refresh).setOnClickListener(v -> repository.generate());
        findViewById(R.id.diagnostic_repair).setOnClickListener(v -> repository.repairNetworkTools());
        findViewById(R.id.diagnostic_plugins).setOnClickListener(v -> startActivity(new android.content.Intent(this, MainActivity.class).putExtra("open_plugins", true)));
        repository.report.observe(this, text -> ((TextView) findViewById(R.id.diagnostic_report)).setText(text));
        repository.busy.observe(this, busy -> {
            ((TextView) findViewById(R.id.diagnostic_status)).setText(busy ? "正在检查环境…" : "报告保留在本机，仅用于本地排查，不会自动上传");
            for (int id : new int[]{R.id.diagnostic_refresh,R.id.diagnostic_repair}) findViewById(id).setEnabled(!busy);
        });
        if (saved == null) {
            if (getIntent().getBooleanExtra("download_error_logs", false)) logs.download();
            else repository.generate();
        }
    }
}

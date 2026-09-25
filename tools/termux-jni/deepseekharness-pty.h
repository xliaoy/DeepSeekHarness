#include <jni.h>
#include <sys/types.h>

int DeepSeekHarness_pty_prepare(int pair[2]);
int DeepSeekHarness_pty_parent(JNIEnv* env, int pair[2], pid_t pid);
void DeepSeekHarness_pty_child(int pair[2]);

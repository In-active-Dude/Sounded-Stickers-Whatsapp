#include <jni.h>
#include <algorithm>
#include <string>
#include <vector>
#include "node.h"

extern "C" JNIEXPORT jint JNICALL
Java_com_soundsticker_runtimecheck_MainActivity_startNode(JNIEnv* env, jobject, jobjectArray args) {
    const jsize n = env->GetArrayLength(args);
    std::vector<std::string> strings;
    for (jsize i = 0; i < n; ++i) {
        auto value = static_cast<jstring>(env->GetObjectArrayElement(args, i));
        const char* chars = env->GetStringUTFChars(value, nullptr);
        strings.emplace_back(chars);
        env->ReleaseStringUTFChars(value, chars);
        env->DeleteLocalRef(value);
    }
    size_t total = 0; for (const auto& s : strings) total += s.size() + 1;
    std::vector<char> buffer(total);
    std::vector<char*> argv;
    size_t pos = 0;
    for (const auto& s : strings) {
        argv.push_back(buffer.data() + pos);
        std::copy(s.begin(), s.end(), buffer.data() + pos);
        pos += s.size(); buffer[pos++] = 0;
    }
    return node::Start(n, argv.data());
}

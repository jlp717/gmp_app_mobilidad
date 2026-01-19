# GMP Movilidad ProGuard Rules
# ====================================
# Professional obfuscation for Play Store

# Keep annotations
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable

# Keep Flutter engine
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Keep model classes (adjust package if needed)
-keep class com.maripepa.gmp_mobilidad.** { *; }

# Keep Dio HTTP client
-keep class io.flutter.plugins.urllauncher.** { *; }

# ============================================
# Google Play Core (Required for R8)
# ============================================
-dontwarn com.google.android.play.core.**
-keep class com.google.android.play.core.** { *; }
-keep class com.google.android.play.core.splitcompat.** { *; }
-keep class com.google.android.play.core.splitinstall.** { *; }
-keep class com.google.android.play.core.tasks.** { *; }

# Suppress warnings for common libraries
-dontwarn retrofit2.**
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# Optimization
-optimizationpasses 5
-dontusemixedcaseclassnames
-verbose

# Remove debug logs in release
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
}

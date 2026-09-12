import java.util.Properties
import java.io.FileInputStream
import org.gradle.api.tasks.compile.JavaCompile
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Load key.properties for signing
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
if (!keystorePropertiesFile.exists()) {
    throw GradleException("Release signing requires android/key.properties; refusing to use debug signing")
}
keystoreProperties.load(FileInputStream(keystorePropertiesFile))

android {
    namespace = "com.maripepa.gmp_mobilidad"
    compileSdk = 36
    // ndkVersion = flutter.ndkVersion // Commented out to let Gradle decide

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }

    defaultConfig {
        // Play Console production package (GMP Movilidad).
        applicationId = "com.maripepa.gmp_mobilidad"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        multiDexEnabled = true
        // Optional: ORG_GRADLE_PROJECT_ABI_FILTER=x86_64 for emulator-only APKs.
        val abiFilter = (project.findProperty("ABI_FILTER") as String?)?.trim()
        if (!abiFilter.isNullOrEmpty()) {
            ndk {
                abiFilters.clear()
                abiFilters.add(abiFilter)
            }
        }
    }



    buildTypes {
        getByName("release") {
            // Disabled due to NDK strip issue on Windows - AAB is still valid
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("androidx.multidex:multidex:2.0.1")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}

// Suppress obsolete source/target (Java 8) warnings coming from some plugins.
// Flutter still injects integration_test into GeneratedPluginRegistrant (dev_dependency)
// which does not exist on the release classpath.
tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.addAll(listOf("-Xlint:-options"))
    if (name.contains("Release", ignoreCase = true)) {
        doFirst {
            val registrant = file("src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java")
            if (registrant.exists()) {
                val original = registrant.readText()
                val stripped = original.replace(
                    Regex(
                        """\s*try \{\s*flutterEngine\.getPlugins\(\)\.add\(new dev\.flutter\.plugins\.integration_test\.IntegrationTestPlugin\(\)\);\s*\} catch \(Exception e\) \{\s*Log\.e\(TAG, "Error registering plugin integration_test,[^"]+", e\);\s*\}""",
                    ),
                    "",
                )
                if (stripped != original) {
                    registrant.writeText(stripped)
                    logger.lifecycle("Stripped integration_test from GeneratedPluginRegistrant for release")
                }
            }
        }
    }
}






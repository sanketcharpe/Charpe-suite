plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/* The build number comes from GitHub (each automatic build is one higher), so
   every new APK installs over the old one and keeps your data. */
val buildNo = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "in.charpe.suite"
    compileSdk = 34

    defaultConfig {
        applicationId = "in.charpe.suite"
        minSdk = 24
        targetSdk = 34
        versionCode = 100 + buildNo
        versionName = "2.$buildNo"
    }

    /* One fixed signing key, kept in the repository, so that every new APK is
       accepted by Android as an update of the one already installed. */
    signingConfigs {
        create("charpe") {
            storeFile = file("charpe-release.jks")
            storePassword = "charpe-suite"
            keyAlias = "charpe"
            keyPassword = "charpe-suite"
        }
    }

    buildFeatures { buildConfig = true }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("charpe")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}

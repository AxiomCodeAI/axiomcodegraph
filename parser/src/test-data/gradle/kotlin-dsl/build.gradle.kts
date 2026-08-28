plugins {
    java
    id("org.springframework.boot") version "3.2.2"
    alias(libs.plugins.boot)
}

val springVersion: String by extra("6.1.3")
val nexusUrl: String by project

group = "com.example"
version = "2.0.0"

repositories {
    mavenCentral()
    maven {
        url = uri("https://repo.example.com/releases")
        credentials(HttpHeaderCredentials::class) {
            name = "Authorization"
        }
    }
}

dependencies {
    implementation("org.springframework:spring-core:$springVersion")
    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.2.2"))
    testImplementation(kotlin("test"))
    implementation(libs.jackson.databind)
}

tasks.named<Test>("test") {
    useJUnitPlatform()
}

tasks.register<Copy>("copyReports") {
    from("build/reports")
}

val buildNumber = (findProperty("buildNumber") as String?) ?: "0"

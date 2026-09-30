// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "fm-compose",
    platforms: [.macOS(.v26)],
    targets: [.executableTarget(name: "fm-compose")]
)

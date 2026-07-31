// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "MelodyRenderProof",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "MelodyRenderKit", targets: ["MelodyRenderKit"]),
        .executable(name: "melody-render-proof", targets: ["MelodyRenderProof"]),
    ],
    dependencies: [
        .package(path: "../RecordingAnalysisKit"),
    ],
    targets: [
        .target(
            name: "MelodyRenderKit",
            dependencies: ["RecordingAnalysisKit"]
        ),
        .executableTarget(
            name: "MelodyRenderProof",
            dependencies: ["MelodyRenderKit", "RecordingAnalysisKit"]
        ),
    ]
)

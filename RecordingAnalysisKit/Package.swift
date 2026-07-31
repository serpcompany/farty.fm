// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "RecordingAnalysisKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "RecordingAnalysisKit", targets: ["RecordingAnalysisKit"]),
        .executable(name: "recording-analysis", targets: ["RecordingAnalysisCLI"]),
    ],
    targets: [
        .target(name: "RecordingAnalysisKit"),
        .executableTarget(
            name: "RecordingAnalysisCLI",
            dependencies: ["RecordingAnalysisKit"]
        ),
        .testTarget(
            name: "RecordingAnalysisKitTests",
            dependencies: ["RecordingAnalysisKit"]
        ),
    ]
)

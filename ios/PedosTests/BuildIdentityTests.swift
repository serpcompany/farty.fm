import XCTest

/// SERP native app build identity: the Debug test host never shares the product's
/// identifier, and the test bundles keep their own.
/// `scripts/check-bundle-identifiers.sh` checks the Release identifier, which a
/// Debug test run can't observe.
final class BuildIdentityTests: XCTestCase {
    func testTestHostIsTheDebugBuildOfPedos() {
        XCTAssertEqual(Bundle.main.bundleURL.lastPathComponent, "Pedos.app")
        XCTAssertEqual(Bundle.main.bundleIdentifier, "com.serp.pedos.debug")
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String, "Pedos")
    }

    func testUnitTestBundleHasItsOwnIdentifier() {
        XCTAssertEqual(Bundle(for: BuildIdentityTests.self).bundleIdentifier, "com.serp.pedos.tests")
    }
}

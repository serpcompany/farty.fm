import XCTest

class AppTabsUITests: PedosUITestCase {
    /// Opens on Record, in the center of five tabs, visits every other tab and comes back to
    /// Record.
    func testAppOpensOnRecordAndVisitsEveryTab() {
        let app = launch(start: "new")

        let recordTab = app.tabBars.buttons["Record"]
        let recordButton = app.buttons["record-button"]
        XCTAssertTrue(recordButton.waitForExistence(timeout: 5), "Pedos did not open on Record")
        XCTAssertEqual(
            app.tabBars.buttons.allElementsBoundByIndex.map { $0.label },
            ["Recordings", "Compose", "Record", "Toots", "Profile"]
        )
        XCTAssertTrue(recordTab.isSelected, "The Record tab is not selected on launch")
        XCTAssertTrue(recordButton.isHittable, "The record button can't be tapped")
        attachScreenshot("record-tabs")

        for tab in ["Recordings", "Compose", "Toots", "Profile"] {
            app.tabBars.buttons[tab].tap()
            XCTAssertTrue(app.navigationBars[tab].waitForExistence(timeout: 5), "\(tab) is not showing")
            XCTAssertFalse(recordButton.exists, "\(tab) shows a record button; only the Record tab should")
        }

        recordTab.tap()
        XCTAssertTrue(recordButton.waitForExistence(timeout: 5), "The Record tab did not come back")
    }
}

final class AppTabsDarkUITests: AppTabsUITests {
    override class var appearance: XCUIDevice.Appearance { .dark }
}

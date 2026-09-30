import XCTest

final class AppTabsUITests: XCTestCase {
    /// Opens on Record, checks the tab order, visits every other tab and comes back to
    /// Record, attaching a screenshot of each tab.
    @MainActor
    func testAppOpensOnRecordAndVisitsEveryTab() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()

        let recordTab = app.tabBars.buttons["Record"]
        let recordButton = app.buttons["record-button"]
        XCTAssertTrue(recordButton.waitForExistence(timeout: 5), "Pedos did not open on Record")
        XCTAssertEqual(
            app.tabBars.buttons.allElementsBoundByIndex.map { $0.label },
            ["Record", "Recordings", "Compose", "Melodies"]
        )
        XCTAssertTrue(recordTab.isSelected, "The Record tab is not selected on launch")
        XCTAssertTrue(recordButton.isHittable, "The record button can't be tapped")
        attachScreenshot(of: app, named: "Record")

        for tab in ["Recordings", "Compose", "Melodies"] {
            app.tabBars.buttons[tab].tap()
            XCTAssertTrue(app.navigationBars[tab].waitForExistence(timeout: 5), "\(tab) is not showing")
            XCTAssertFalse(recordButton.exists, "\(tab) shows a record button; only the Record tab should")
            attachScreenshot(of: app, named: tab)
        }

        recordTab.tap()
        XCTAssertTrue(recordButton.waitForExistence(timeout: 5), "The Record tab did not come back")
    }

    @MainActor
    private func attachScreenshot(of app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

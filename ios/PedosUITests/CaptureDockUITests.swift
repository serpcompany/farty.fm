import XCTest

final class CaptureDockUITests: XCTestCase {
    /// Opens on Record, visits every other dock area and comes back to Record, attaching a
    /// screenshot of each area.
    @MainActor
    func testDockOpensOnRecordAndVisitsEveryArea() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()

        let recordTab = app.tabBars.buttons["Record"]
        let recordButton = app.buttons["record-button"]
        XCTAssertTrue(recordButton.waitForExistence(timeout: 5), "Pedos did not open on Record")
        XCTAssertTrue(recordTab.isSelected, "The Record tab is not selected on launch")
        XCTAssertTrue(recordButton.isHittable, "The record button can't be tapped")
        attachScreenshot(of: app, named: "Record")

        let areas = [
            (tab: "Recordings", title: "Recordings"),
            (tab: "Create", title: "Create"),
            (tab: "Melodies", title: "Created Melodies"),
        ]
        for area in areas {
            app.tabBars.buttons[area.tab].tap()
            XCTAssertTrue(app.navigationBars[area.title].waitForExistence(timeout: 5), "\(area.title) is not showing")
            XCTAssertFalse(recordButton.exists, "\(area.title) shows a record button; only the Record tab should")
            attachScreenshot(of: app, named: area.title)
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

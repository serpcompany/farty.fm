/**
 * Framework7 iOS Component Showcase
 * Reference page showing all available F7 components for wireframes
 */
import {
  App,
  View,
  Page,
  Navbar,
  NavLeft,
  NavRight,
  Link,
  Toolbar,
  Block,
  BlockTitle,
  List,
  ListItem,
  ListInput,
  Toggle,
  Range,
  Stepper,
  Button,
  Segmented,
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  Chip,
  Badge,
  Icon,
  Fab,
  FabButton,
  FabButtons,
  Preloader,
  Progressbar,
  Sheet,
  Popup,
  Actions,
  ActionsGroup,
  ActionsLabel,
  ActionsButton,
  f7,
} from "framework7-react";
import { useState } from "react";

export default function F7ComponentShowcase() {
  const [activeTab, setActiveTab] = useState("navigation");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);

  const tabs = [
    { id: "navigation", label: "Navigation" },
    { id: "lists", label: "Lists" },
    { id: "forms", label: "Forms" },
    { id: "buttons", label: "Buttons" },
    { id: "cards", label: "Cards" },
    { id: "overlays", label: "Overlays" },
    { id: "feedback", label: "Feedback" },
  ];

  return (
    <App theme="ios" className="f7-showcase-app">
      <View main>
        <Page>
          {/* iOS Navigation Bar */}
          <Navbar large transparent title="F7 Components">
            <NavLeft>
              <Link iconF7="arrow_left" />
            </NavLeft>
            <NavRight>
              <Link iconF7="gear" />
            </NavRight>
          </Navbar>

          {/* Tab Selector */}
          <Block>
            <Segmented strong tag="p">
              {tabs.map((tab) => (
                <Button
                  key={tab.id}
                  active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </Button>
              ))}
            </Segmented>
          </Block>

          {/* Navigation Components */}
          {activeTab === "navigation" && (
            <>
              <BlockTitle>Navbar Variations</BlockTitle>
              <Block strong inset>
                <p>Standard navbar with back button, title, and right action</p>
              </Block>

              <BlockTitle>Toolbar (Bottom)</BlockTitle>
              <Block strong inset>
                <Toolbar tabbar icons bottom>
                  <Link tabLink iconF7="house_fill" text="Home" />
                  <Link tabLink iconF7="clock_fill" text="History" />
                  <Link tabLink iconF7="music_note_2" text="AI" />
                  <Link tabLink iconF7="chart_bar_fill" text="Stats" />
                  <Link tabLink iconF7="gear" text="Settings" />
                </Toolbar>
              </Block>

              <BlockTitle>Tab Bar</BlockTitle>
              <Toolbar tabbar icons>
                <Link tabLink="#tab-1" tabLinkActive iconF7="house_fill" text="Home" />
                <Link tabLink="#tab-2" iconF7="clock" text="Recent" />
                <Link tabLink="#tab-3" iconF7="person" text="Profile" />
              </Toolbar>
            </>
          )}

          {/* List Components */}
          {activeTab === "lists" && (
            <>
              <BlockTitle>Simple List</BlockTitle>
              <List strong outlineIos>
                <ListItem title="Item 1" />
                <ListItem title="Item 2" />
                <ListItem title="Item 3" />
              </List>

              <BlockTitle>List with Icons & Badges</BlockTitle>
              <List strong outlineIos>
                <ListItem link title="Notifications" badge="5" badgeColor="red">
                  <Icon slot="media" f7="bell_fill" />
                </ListItem>
                <ListItem link title="Messages" badge="New" badgeColor="green">
                  <Icon slot="media" f7="envelope_fill" />
                </ListItem>
                <ListItem link title="Settings">
                  <Icon slot="media" f7="gear" />
                </ListItem>
              </List>

              <BlockTitle>List with After & Subtitle</BlockTitle>
              <List strong outlineIos mediaList>
                <ListItem
                  link
                  title="Recording 1"
                  subtitle="2 seconds"
                  after="Today"
                  text="Kitchen"
                />
                <ListItem
                  link
                  title="Recording 2"
                  subtitle="5 seconds"
                  after="Yesterday"
                  text="Living Room"
                />
              </List>

              <BlockTitle>Swipeout Actions</BlockTitle>
              <List strong outlineIos>
                <ListItem
                  title="Swipe me left"
                  swipeout
                >
                  <div slot="after" className="swipeout-delete">Delete</div>
                </ListItem>
              </List>

              <BlockTitle>Grouped List</BlockTitle>
              <List strong outlineIos>
                <ListItem groupTitle title="A" />
                <ListItem title="Aaron" />
                <ListItem title="Adam" />
                <ListItem groupTitle title="B" />
                <ListItem title="Barry" />
                <ListItem title="Bob" />
              </List>
            </>
          )}

          {/* Form Components */}
          {activeTab === "forms" && (
            <>
              <BlockTitle>Text Inputs</BlockTitle>
              <List strong outlineIos>
                <ListInput label="Name" type="text" placeholder="Your name" />
                <ListInput label="Email" type="email" placeholder="Email" />
                <ListInput label="Password" type="password" placeholder="Password" />
                <ListInput label="Bio" type="textarea" placeholder="About you..." />
              </List>

              <BlockTitle>Toggle Switches</BlockTitle>
              <List strong outlineIos>
                <ListItem title="Notifications">
                  <Toggle slot="after" defaultChecked />
                </ListItem>
                <ListItem title="Sound Effects">
                  <Toggle slot="after" />
                </ListItem>
                <ListItem title="Auto-save">
                  <Toggle slot="after" defaultChecked />
                </ListItem>
              </List>

              <BlockTitle>Range Slider</BlockTitle>
              <List strong outlineIos>
                <ListItem>
                  <span>Volume</span>
                  <Range slot="after" min={0} max={100} step={1} value={50} />
                </ListItem>
              </List>

              <BlockTitle>Stepper</BlockTitle>
              <List strong outlineIos>
                <ListItem title="Quantity">
                  <Stepper slot="after" value={1} min={1} max={10} />
                </ListItem>
              </List>

              <BlockTitle>Smart Select</BlockTitle>
              <List strong outlineIos>
                <ListItem title="Genre" smartSelect>
                  <select name="genre" defaultValue="pop">
                    <option value="pop">Pop</option>
                    <option value="rock">Rock</option>
                    <option value="jazz">Jazz</option>
                    <option value="hiphop">Hip Hop</option>
                  </select>
                </ListItem>
              </List>
            </>
          )}

          {/* Button Components */}
          {activeTab === "buttons" && (
            <>
              <BlockTitle>Standard Buttons</BlockTitle>
              <Block strong>
                <p>
                  <Button fill>Fill Button</Button>
                </p>
                <p>
                  <Button outline>Outline Button</Button>
                </p>
                <p>
                  <Button>Default Button</Button>
                </p>
                <p>
                  <Button fill round>Round Button</Button>
                </p>
                <p>
                  <Button fill large>Large Button</Button>
                </p>
                <p>
                  <Button fill small>Small Button</Button>
                </p>
              </Block>

              <BlockTitle>Button Colors</BlockTitle>
              <Block strong>
                <p><Button fill color="red">Red</Button></p>
                <p><Button fill color="green">Green</Button></p>
                <p><Button fill color="blue">Blue</Button></p>
                <p><Button fill color="orange">Orange</Button></p>
              </Block>

              <BlockTitle>Segmented Control</BlockTitle>
              <Block strong>
                <Segmented strong tag="p">
                  <Button active>Active</Button>
                  <Button>Tab 2</Button>
                  <Button>Tab 3</Button>
                </Segmented>
              </Block>

              <BlockTitle>Chips</BlockTitle>
              <Block strong>
                <Chip text="Simple Chip" />
                <Chip text="Outline Chip" outline />
                <Chip text="With Icon" mediaBgColor="blue">
                  <Icon slot="media" f7="plus_circle_fill" size={20} />
                </Chip>
                <Chip text="Deletable" deleteable />
              </Block>

              <BlockTitle>FAB (Floating Action Button)</BlockTitle>
              <Block strong inset>
                <p>Check bottom-right corner of screen</p>
              </Block>
            </>
          )}

          {/* Card Components */}
          {activeTab === "cards" && (
            <>
              <BlockTitle>Simple Card</BlockTitle>
              <Card>
                <CardContent>
                  <p>This is a simple card with text content.</p>
                </CardContent>
              </Card>

              <BlockTitle>Card with Header & Footer</BlockTitle>
              <Card>
                <CardHeader>Recording Details</CardHeader>
                <CardContent>
                  <p>Duration: 3.2 seconds</p>
                  <p>Location: Kitchen</p>
                </CardContent>
                <CardFooter>
                  <Link>Play</Link>
                  <Link>Share</Link>
                </CardFooter>
              </Card>

              <BlockTitle>Expandable Card</BlockTitle>
              <Card expandable>
                <CardContent padding={false}>
                  <div className="bg-gray-200 h-48 flex items-center justify-center">
                    <span className="text-gray-500">Tap to expand</span>
                  </div>
                </CardContent>
                <CardHeader>Expandable Card</CardHeader>
                <CardFooter>More content inside...</CardFooter>
              </Card>

              <BlockTitle>Card with Background</BlockTitle>
              <Card className="bg-gradient-to-br from-purple-500 to-pink-500 text-white">
                <CardHeader className="text-white/70">Featured</CardHeader>
                <CardContent>
                  <h2 className="text-xl font-bold">Your Generated Song</h2>
                  <p className="text-white/80">Ready to play</p>
                </CardContent>
              </Card>
            </>
          )}

          {/* Overlay Components */}
          {activeTab === "overlays" && (
            <>
              <BlockTitle>Bottom Sheet</BlockTitle>
              <Block strong>
                <Button fill onClick={() => setSheetOpen(true)}>
                  Open Sheet
                </Button>
              </Block>

              <BlockTitle>Action Sheet</BlockTitle>
              <Block strong>
                <Button fill onClick={() => setActionsOpen(true)}>
                  Open Actions
                </Button>
              </Block>

              <BlockTitle>Popup / Modal</BlockTitle>
              <Block strong>
                <Button fill onClick={() => setPopupOpen(true)}>
                  Open Popup
                </Button>
              </Block>

              <BlockTitle>Toast (via f7.toast)</BlockTitle>
              <Block strong>
                <Button
                  fill
                  onClick={() =>
                    f7.toast
                      .create({
                        text: "Recording saved!",
                        closeTimeout: 2000,
                        position: "center",
                      })
                      .open()
                  }
                >
                  Show Toast
                </Button>
              </Block>

              <BlockTitle>Dialog (via f7.dialog)</BlockTitle>
              <Block strong>
                <Button
                  fill
                  onClick={() =>
                    f7.dialog.confirm("Delete this recording?", "Confirm", () => {
                      f7.toast.show({ text: "Deleted!", closeTimeout: 1000 });
                    })
                  }
                >
                  Show Confirm Dialog
                </Button>
              </Block>

              {/* Sheet */}
              <Sheet
                opened={sheetOpen}
                onSheetClosed={() => setSheetOpen(false)}
                swipeToClose
                backdrop
              >
                <Page>
                  <BlockTitle large>Sheet Content</BlockTitle>
                  <Block>
                    <p>This is a draggable bottom sheet. Swipe down to close.</p>
                    <List strong outlineIos>
                      <ListItem link title="Option 1" />
                      <ListItem link title="Option 2" />
                      <ListItem link title="Option 3" />
                    </List>
                  </Block>
                </Page>
              </Sheet>

              {/* Actions */}
              <Actions opened={actionsOpen} onActionsClosed={() => setActionsOpen(false)}>
                <ActionsGroup>
                  <ActionsLabel>Choose Action</ActionsLabel>
                  <ActionsButton>Share Recording</ActionsButton>
                  <ActionsButton>Add to Favorites</ActionsButton>
                  <ActionsButton>Edit Tags</ActionsButton>
                </ActionsGroup>
                <ActionsGroup>
                  <ActionsButton color="red">Delete</ActionsButton>
                </ActionsGroup>
                <ActionsGroup>
                  <ActionsButton>Cancel</ActionsButton>
                </ActionsGroup>
              </Actions>

              {/* Popup */}
              <Popup opened={popupOpen} onPopupClosed={() => setPopupOpen(false)}>
                <Page>
                  <Navbar title="Popup Modal">
                    <NavRight>
                      <Link popupClose>Close</Link>
                    </NavRight>
                  </Navbar>
                  <Block>
                    <p>This is a full-screen popup modal.</p>
                    <p>Great for forms, detail views, or complex flows.</p>
                  </Block>
                </Page>
              </Popup>
            </>
          )}

          {/* Feedback Components */}
          {activeTab === "feedback" && (
            <>
              <BlockTitle>Preloader / Spinner</BlockTitle>
              <Block strong className="flex gap-4 items-center">
                <Preloader />
                <Preloader color="blue" />
                <Preloader color="green" />
                <Preloader size={44} />
              </Block>

              <BlockTitle>Progress Bar</BlockTitle>
              <Block strong>
                <p><Progressbar progress={25} /></p>
                <p><Progressbar progress={50} color="blue" /></p>
                <p><Progressbar progress={75} color="green" /></p>
                <p><Progressbar infinite color="multi" /></p>
              </Block>

              <BlockTitle>Badges</BlockTitle>
              <Block strong className="flex gap-4 items-center">
                <Badge>Default</Badge>
                <Badge color="red">3</Badge>
                <Badge color="green">New</Badge>
                <Badge color="blue">Pro</Badge>
              </Block>

              <BlockTitle>Skeleton / Loading State</BlockTitle>
              <List strong outlineIos mediaList>
                <ListItem
                  className="skeleton-text skeleton-effect-wave"
                  title="Loading title..."
                  subtitle="Subtitle text"
                  text="Some description goes here"
                />
                <ListItem
                  className="skeleton-text skeleton-effect-wave"
                  title="Another item..."
                  subtitle="More text"
                  text="Description placeholder"
                />
              </List>
            </>
          )}

          {/* FAB Button */}
          <Fab position="right-bottom" slot="fixed">
            <Icon f7="plus" />
            <Icon f7="xmark" />
            <FabButtons position="top">
              <FabButton label="Record">
                <Icon f7="mic_fill" />
              </FabButton>
              <FabButton label="Import">
                <Icon f7="folder_fill" />
              </FabButton>
            </FabButtons>
          </Fab>
        </Page>
      </View>
    </App>
  );
}

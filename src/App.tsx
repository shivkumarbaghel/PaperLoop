import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import type { User } from "firebase/auth";
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleDollarSign,
  Eye,
  FileUp,
  Filter,
  Flag,
  Fullscreen,
  Globe2,
  Heart,
  LayoutDashboard,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  Newspaper,
  PlaySquare,
  Plus,
  ExternalLink,
  Search,
  Share2,
  Trash2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
  Users,
  Video,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  completeGoogleRedirectSignIn,
  isFirebaseConfigured,
  signInWithEmailPassword,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
} from "./firebase";
import {
  canOpenAdminWorkspace,
  canManagePlatform,
  canReadArticle,
  canReadEdition,
  canUseDiscussion,
  canManagePublisher,
  hasPublisherSubscription,
} from "./services/authorization";
import {
  getPaperLoopContent,
  mockContent,
  type PaperLoopContent,
} from "./services/contentRepository";
import {
  createArticleComment,
  recordEngagement,
  type EngagementType,
} from "./services/engagementRepository";
import {
  createPublisherStaffInvite,
  getPublisherStaffDirectory,
  getPublisherStaffInvites,
  updatePublisherStaffStatus,
} from "./services/accessManagementRepository";
import {
  appendEditionPagesFromFile,
  createAdvertiserCampaign,
  createArticleBlockFromPreviewPage,
  createDraftClipPreviewUrl,
  createEditionDraft,
  deleteArticleBlock,
  deletePublisherEdition,
  deletePublisherEditionPage,
  extractClipRegionDetails,
  generateEditionPreviewPages,
  getEditionById,
  getEditionLanguages,
  getEditionLocations,
  getPublisherArticlePostDetail,
  getPublisherArticleBlocks,
  getPublisherComments,
  getPublisherWorkspaceEditions,
  requestSmartEditionProcessing,
  saveArticleBlockDraft,
  updateArticleBlockStatus,
  updateEditionWorkflowStatus,
  updatePublisherArticlePost,
  uploadPublisherClipImage,
  type CampaignInput,
  type PublisherArticlePostDetail,
  type PublisherCommentActivity,
  type PublisherEngagementActivity,
} from "./services/publisherWorkspaceRepository";
import {
  ClipRegionDrawer,
  type ClipRegionGeometry,
} from "./components/ClipRegionDrawer";
import {
  editionLocations as fallbackEditionLocations,
  type EditionLocation,
} from "./data/locationData";
import {
  editionLanguages as fallbackEditionLanguages,
  type EditionLanguage,
} from "./data/languageData";
import {
  emptyUserAccess,
  getUserAccess,
  subscribeToUserProfile,
  type UserAccess,
} from "./services/userRepository";
import type {
  ArticlePost,
  ArticleBlock,
  ArticleBlockStatus,
  ArticleBlockType,
  AccessRule,
  Campaign,
  Comment,
  DiscussionRule,
  Edition,
  EditionStatus,
  MetricCard,
  Page,
  Publisher,
  PublisherStaffInvite,
  PublisherStaffMembership,
  UserProfile,
} from "./types";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

type View = "dashboard" | "reader" | "article" | "admin";

const EDITION_STUDIO_PATH = "/admin/edition-studio";
const EDITION_STUDIO_CONTEXT_KEY = "paperloop.editionStudioContext";

function activeViewFromPath(pathname: string): View {
  if (pathname.startsWith("/admin")) {
    return "admin";
  }

  if (pathname.startsWith("/article")) {
    return "article";
  }

  if (pathname.startsWith("/reader")) {
    return "reader";
  }

  return "dashboard";
}
type BlockGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type EditionStudioContext = {
  previewEditionId: string;
  articlePageId: string;
  selectedBlockId: string;
  sidebarTab: "pages" | "clips";
};

const staffRoles: PublisherStaffMembership["role"][] = [
  "agency_admin",
  "publisher_admin",
  "editor",
  "moderator",
  "columnist",
];
const blockTypes: ArticleBlockType[] = [
  "article",
  "advertisement",
  "photo",
  "notice",
  "other",
];

function findLocationByCity(
  city: string | undefined,
  locations: EditionLocation[],
) {
  if (!city) {
    return undefined;
  }

  return locations.find((location) => location.cities.includes(city));
}

function publisherStateName(
  publisher: Publisher,
  locations: EditionLocation[],
) {
  return findLocationByCity(publisher.city, locations)?.state ?? publisher.region;
}

function filterPublishersByLocale(
  publishers: Publisher[],
  locations: EditionLocation[],
  filters: { language: string; state: string; city: string },
) {
  return publishers
    .filter((publisher) => {
      const resolvedState = publisherStateName(publisher, locations);
      const matchesLanguage =
        filters.language === "All" || publisher.language === filters.language;
      const matchesState = filters.state === "All" || resolvedState === filters.state;
      const matchesCity = filters.city === "All" || publisher.city === filters.city;

      return matchesLanguage && matchesState && matchesCity;
    })
    .sort((a, b) => socialRankScore(b) - socialRankScore(a));
}

function readEditionStudioContext(): EditionStudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.sessionStorage.getItem(EDITION_STUDIO_CONTEXT_KEY);

    if (!storedValue) {
      return null;
    }

    const parsedValue = JSON.parse(storedValue) as Partial<EditionStudioContext>;

    if (!parsedValue.previewEditionId || !parsedValue.articlePageId) {
      return null;
    }

    return {
      previewEditionId: parsedValue.previewEditionId,
      articlePageId: parsedValue.articlePageId,
      selectedBlockId: parsedValue.selectedBlockId ?? "",
      sidebarTab: parsedValue.sidebarTab === "clips" ? "clips" : "pages",
    };
  } catch {
    return null;
  }
}

function writeEditionStudioContext(context: EditionStudioContext) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    EDITION_STUDIO_CONTEXT_KEY,
    JSON.stringify(context),
  );
}

function articleStudioContext(article: ArticlePost): EditionStudioContext {
  return {
    previewEditionId: article.editionId,
    articlePageId: article.pageId,
    selectedBlockId: article.sourceBlockId ?? "",
    sidebarTab: "clips",
  };
}

function samePublisherId(left: string, right: string) {
  return left.replace(/[^a-z0-9]/gi, "").toLowerCase() ===
    right.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeView = activeViewFromPath(location.pathname);
  const [selectedPublisherId, setSelectedPublisherId] = useState(
    mockContent.publishers[0].id,
  );
  const [selectedEditionId, setSelectedEditionId] = useState("");
  const [selectedArticleId, setSelectedArticleId] = useState(
    mockContent.articles[0].id,
  );
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("All");
  const [state, setState] = useState("All");
  const [city, setCity] = useState("All");
  const [topic, setTopic] = useState("All");
  const [editionLocations, setEditionLocations] = useState<EditionLocation[]>(
    fallbackEditionLocations,
  );
  const [editionLanguages, setEditionLanguages] = useState<EditionLanguage[]>(
    fallbackEditionLanguages,
  );
  const [readerLanguage, setReaderLanguage] = useState("All");
  const [readerState, setReaderState] = useState("All");
  const [readerCity, setReaderCity] = useState("All");
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [readerMode, setReaderMode] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [emailLogin, setEmailLogin] = useState("");
  const [passwordLogin, setPasswordLogin] = useState("");
  const [authPending, setAuthPending] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [userAccess, setUserAccess] = useState<UserAccess>(emptyUserAccess);
  const [accessStatus, setAccessStatus] = useState<
    "signed_out" | "loading" | "ready" | "error"
  >("signed_out");
  const [authError, setAuthError] = useState("");
  const [content, setContent] = useState<PaperLoopContent>(mockContent);
  const [contentStatus, setContentStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  const { publishers, editions, articles, campaigns } = content;

  useEffect(
    () =>
      subscribeToAuth((nextUser) => {
        setAuthUser(nextUser);

        if (!nextUser) {
          setProfile(null);
          setUserAccess(emptyUserAccess);
          setAccessStatus("signed_out");
        } else {
          setAccessStatus("loading");
        }
      }),
    [],
  );

  useEffect(() => {
    completeGoogleRedirectSignIn().catch((error) => {
      setAuthError(
        error instanceof Error ? error.message : "Unable to complete Google sign in.",
      );
    });
  }, []);

  useEffect(() => {
    if (!authUser) {
      return undefined;
    }

    const unsubscribe = subscribeToUserProfile(
      authUser.uid,
      (nextProfile) => {
        setProfile(nextProfile);
        setAccessStatus("ready");
      },
      () => {
        setAccessStatus("error");
        setAuthError("Unable to load your account permissions.");
      },
    );

    getUserAccess(authUser.uid)
      .then((nextAccess) => setUserAccess(nextAccess))
      .catch(() => {
        setUserAccess(emptyUserAccess);
        setAccessStatus("error");
        setAuthError("Unable to load your publisher or subscription access.");
      });

    return unsubscribe;
  }, [authUser]);

  useEffect(() => {
    let active = true;

    getPaperLoopContent()
      .then((nextContent) => {
        if (!active) {
          return;
        }

        setContent(nextContent);
        setContentStatus("ready");
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setContent(mockContent);
        setContentStatus("error");
      });

    return () => {
      active = false;
    };
  }, [authUser?.uid]);

  useEffect(() => {
    let active = true;

    Promise.all([getEditionLocations(), getEditionLanguages()]).then(
      ([locations, languages]) => {
        if (!active) {
          return;
        }

        setEditionLocations(locations);
        setEditionLanguages(languages);
      },
    );

    return () => {
      active = false;
    };
  }, []);

  const languageOptions = useMemo(
    () => ["All", ...editionLanguages.map((languageOption) => languageOption.name)],
    [editionLanguages],
  );
  const stateOptions = useMemo(
    () => ["All", ...editionLocations.map((location) => location.state)],
    [editionLocations],
  );
  const cityOptions = useMemo(() => {
    if (state === "All") {
      return ["All"];
    }

    const cities =
      editionLocations.find((location) => location.state === state)?.cities ?? [];

    return ["All", ...cities];
  }, [editionLocations, state]);
  const topicOptions = useMemo(
    () => ["All", ...unique(publishers.flatMap((publisher) => publisher.topics))],
    [publishers],
  );
  const readerLanguageOptions = useMemo(
    () => ["All", ...editionLanguages.map((languageOption) => languageOption.name)],
    [editionLanguages],
  );
  const readerStateOptions = useMemo(
    () => ["All", ...editionLocations.map((location) => location.state)],
    [editionLocations],
  );
  const readerCityOptions = useMemo(() => {
    if (readerState === "All") {
      return ["All"];
    }

    const cities =
      editionLocations.find((location) => location.state === readerState)?.cities ?? [];

    return ["All", ...cities];
  }, [editionLocations, readerState]);
  const readerFilteredPublishers = useMemo(
    () =>
      filterPublishersByLocale(publishers, editionLocations, {
        language: readerLanguage,
        state: readerState,
        city: readerCity,
      }),
    [editionLocations, publishers, readerCity, readerLanguage, readerState],
  );
  const trendingPublishers = useMemo(
    () => readerFilteredPublishers.slice(0, 12),
    [readerFilteredPublishers],
  );

  const selectedPublisher = publishers.find(
    (publisher) => publisher.id === selectedPublisherId,
  ) ?? publishers[0] ?? mockContent.publishers[0];

  const publisherEditions = useMemo(
    () =>
      editions
        .filter((edition) => edition.publisherId === selectedPublisher.id)
        .sort(compareEditionsForReader),
    [editions, selectedPublisher.id],
  );

  const selectedEdition =
    publisherEditions.find((edition) => edition.id === selectedEditionId) ??
    publisherEditions[0] ??
    createPlaceholderEdition(selectedPublisher);

  const preferredReaderEdition = useMemo(
    () =>
      editions
        .slice()
        .sort((a, b) => readerEditionRank(b, articles) - readerEditionRank(a, articles))[0],
    [articles, editions],
  );

  const filteredPublishers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return publishers
      .filter((publisher) => {
        const matchesSearch =
          !normalizedSearch ||
          publisher.name.toLowerCase().includes(normalizedSearch) ||
          publisher.city.toLowerCase().includes(normalizedSearch) ||
          publisher.topics.some((publisherTopic) =>
            publisherTopic.toLowerCase().includes(normalizedSearch),
          );
        const publisherState =
          findLocationByCity(publisher.city, editionLocations)?.state ?? publisher.region;
        const matchesLanguage = language === "All" || publisher.language === language;
        const matchesState = state === "All" || publisherState === state;
        const matchesCity = city === "All" || publisher.city === city;
        const matchesTopic = topic === "All" || publisher.topics.includes(topic);

        return (
          matchesSearch && matchesLanguage && matchesState && matchesCity && matchesTopic
        );
      })
      .sort((a, b) => socialRankScore(b) - socialRankScore(a));
  }, [city, editionLocations, language, publishers, search, state, topic]);

  function handleStateChange(nextState: string) {
    setState(nextState);
    setCity("All");
  }

  function handleReaderStateChange(nextState: string) {
    setReaderState(nextState);
    setReaderCity("All");
  }

  function selectReaderPublisher(publisherId: string) {
    const nextEdition = editions
      .filter((edition) => edition.publisherId === publisherId)
      .sort(compareEditionsForReader)[0];

    setSelectedPublisherId(publisherId);
    setSelectedEditionId(nextEdition?.id ?? "");
    setPageIndex(0);
  }

  useEffect(() => {
    if (activeView !== "reader" || readerFilteredPublishers.length === 0) {
      return;
    }

    if (
      preferredReaderEdition &&
      (!selectedEditionId ||
        (editionHasReadablePageAsset(preferredReaderEdition) &&
          !editionHasReadablePageAsset(selectedEdition)))
    ) {
      window.queueMicrotask(() => {
        setSelectedPublisherId(preferredReaderEdition.publisherId);
        setSelectedEditionId(preferredReaderEdition.id);
        setPageIndex(0);
      });
      return;
    }

    if (!readerFilteredPublishers.some((item) => item.id === selectedPublisherId)) {
      const nextPublisherId = readerFilteredPublishers[0].id;
      const nextEdition = editions
        .filter((edition) => edition.publisherId === nextPublisherId)
        .sort(compareEditionsForReader)[0];

      window.queueMicrotask(() => {
        setSelectedPublisherId(nextPublisherId);
        setSelectedEditionId(nextEdition?.id ?? "");
        setPageIndex(0);
      });
    }
  }, [
    activeView,
    editions,
    preferredReaderEdition,
    readerFilteredPublishers,
    selectedEdition,
    selectedEditionId,
    selectedPublisherId,
  ]);

  function openReader(publisher: Publisher) {
    const nextEdition = editions
      .filter((edition) => edition.publisherId === publisher.id)
      .sort(compareEditionsForReader)[0];

    setReaderLanguage(publisher.language);
    setReaderState(publisherStateName(publisher, editionLocations));
    setReaderCity(publisher.city);
    setSelectedPublisherId(publisher.id);
    setSelectedEditionId(nextEdition?.id ?? "");
    setPageIndex(0);
    navigate("/reader");
  }

  function navigateToView(view: View) {
    if (view === "admin" && !canOpenAdminWorkspace(profile, userAccess)) {
      setAuthError(
        authUser
          ? "This account does not have publisher workspace access yet."
          : "Please sign in with an authorized admin or publisher account.",
      );
      return;
    }

    setAuthError("");

    switch (view) {
      case "admin":
        navigate(EDITION_STUDIO_PATH);
        break;
      case "reader":
        navigate("/reader");
        break;
      case "article":
        navigate(`/article/${selectedArticleId}`);
        break;
      default:
        navigate("/");
        break;
    }
  }

  function openArticle(articleId: string) {
    setSelectedArticleId(articleId);
    navigate(`/article/${articleId}`);
  }

  async function handleGoogleLogin() {
    setAuthError("");
    setAuthPending(true);

    try {
      await signInWithGoogle();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setAuthPending(false);
    }
  }

  async function handleEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setAuthPending(true);

    try {
      await signInWithEmailPassword(emailLogin, passwordLogin);
      setPasswordLogin("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setAuthPending(false);
    }
  }

  return (
    <div className="app-shell">
      <Header
        activeView={activeView}
        authUser={authUser}
        emailLogin={emailLogin}
        passwordLogin={passwordLogin}
        authPending={authPending}
        profile={profile}
        accessStatus={accessStatus}
        canOpenAdmin={canOpenAdminWorkspace(profile, userAccess)}
        onNavigate={navigateToView}
        onEmail={setEmailLogin}
        onPassword={setPasswordLogin}
        onEmailSignIn={handleEmailLogin}
        onSignIn={handleGoogleLogin}
        onSignOut={signOutUser}
      />

      {!isFirebaseConfigured && (
        <section className="config-banner" aria-label="Firebase setup needed">
          <ShieldCheck size={18} />
          <span>
            Firebase demo mode: add `.env` values from `.env.example` to enable Google
            login, Firestore, Storage, and Analytics.
          </span>
        </section>
      )}

      {authError && (
        <section className="error-banner" role="alert">
          {authError}
        </section>
      )}

      <main>
        <Routes>
          <Route
            path="/"
            element={
              <Dashboard
                filteredPublishers={filteredPublishers}
                contentSource={content.source}
                contentStatus={contentStatus}
                search={search}
                language={language}
                state={state}
                city={city}
                topic={topic}
                languageOptions={languageOptions}
                stateOptions={stateOptions}
                cityOptions={cityOptions}
                topicOptions={topicOptions}
                onSearch={setSearch}
                onLanguage={setLanguage}
                onState={handleStateChange}
                onCity={setCity}
                onTopic={setTopic}
                onOpenReader={openReader}
              />
            }
          />
          <Route
            path="/reader"
            element={
              <ReaderView
                articles={articles}
                authUser={authUser}
                profile={profile}
                userAccess={userAccess}
                publisher={selectedPublisher}
                edition={selectedEdition}
                editions={publisherEditions}
                trendingPublishers={trendingPublishers}
                readerLanguage={readerLanguage}
                readerState={readerState}
                readerCity={readerCity}
                readerLanguageOptions={readerLanguageOptions}
                readerStateOptions={readerStateOptions}
                readerCityOptions={readerCityOptions}
                pageIndex={pageIndex}
                zoom={zoom}
                readerMode={readerMode}
                onReaderLanguage={setReaderLanguage}
                onReaderState={handleReaderStateChange}
                onReaderCity={setReaderCity}
                onSelectPublisher={selectReaderPublisher}
                onEditionId={(editionId) => {
                  setSelectedEditionId(editionId);
                  setPageIndex(0);
                }}
                onPageIndex={setPageIndex}
                onZoom={setZoom}
                onReaderMode={setReaderMode}
                onOpenArticle={openArticle}
              />
            }
          />
          <Route
            path="/article/:articleId"
            element={
              <ArticleRoute
                articles={articles}
                authUser={authUser}
                profile={profile}
                userAccess={userAccess}
                onAuthRequired={() =>
                  setAuthError("Please sign in with Gmail to use subscriber actions.")
                }
              />
            }
          />
          <Route
            path={EDITION_STUDIO_PATH}
            element={
              <AdminView
                articles={articles}
                campaigns={campaigns}
                editions={editions}
                profile={profile}
                publishers={publishers}
                authUser={authUser}
                userAccess={userAccess}
              />
            }
          />
          <Route
            path="/admin/edition-studio/posts/:articleId"
            element={
              <PublisherClipDetailRoute
                articles={articles}
                authUser={authUser}
                profile={profile}
                publishers={publishers}
                userAccess={userAccess}
              />
            }
          />
          <Route path="/admin" element={<Navigate to={EDITION_STUDIO_PATH} replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

interface HeaderProps {
  activeView: View;
  authUser: User | null;
  emailLogin: string;
  passwordLogin: string;
  authPending: boolean;
  profile: UserProfile | null;
  accessStatus: "signed_out" | "loading" | "ready" | "error";
  canOpenAdmin: boolean;
  onNavigate: (view: View) => void;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onEmailSignIn: (event: FormEvent<HTMLFormElement>) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

function Header({
  activeView,
  authUser,
  emailLogin,
  passwordLogin,
  authPending,
  profile,
  accessStatus,
  canOpenAdmin,
  onNavigate,
  onEmail,
  onPassword,
  onEmailSignIn,
  onSignIn,
  onSignOut,
}: HeaderProps) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate("dashboard")}>
        <span className="brand-mark">PL</span>
        <span>
          <strong>PaperLoop</strong>
          <small>e-akhabaar platform</small>
        </span>
      </button>

      <nav className="main-nav" aria-label="Primary navigation">
        <button
          className={activeView === "dashboard" ? "active" : ""}
          onClick={() => onNavigate("dashboard")}
        >
          <LayoutDashboard size={18} />
          Dashboard
        </button>
        <button
          className={activeView === "reader" || activeView === "article" ? "active" : ""}
          onClick={() => onNavigate("reader")}
        >
          <BookOpen size={18} />
          Reader
        </button>
        <button
          className={activeView === "admin" ? "active" : ""}
          onClick={() => onNavigate("admin")}
          title={
            canOpenAdmin
              ? "Open publisher workspace"
              : "Publisher staff authorization required"
          }
        >
          {canOpenAdmin ? <BarChart3 size={18} /> : <Lock size={18} />}
          Admin
        </button>
      </nav>

      <div className="account-area">
        {authUser ? (
          <>
            <span className="user-chip">
              <UserRound size={16} />
              {authUser.displayName ?? authUser.email}
              <small>{accessStatus === "loading" ? "loading" : profile?.role ?? "reader"}</small>
            </span>
            <button className="icon-button" onClick={onSignOut} aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </>
        ) : (
          <form className="login-form" onSubmit={onEmailSignIn}>
            <label>
              <span className="sr-only">User ID or email</span>
              <input
                type="text"
                value={emailLogin}
                onChange={(event) => onEmail(event.target.value)}
                placeholder="admin or publisher ID"
                autoComplete="username"
              />
            </label>
            <label>
              <span className="sr-only">Password</span>
              <input
                type="password"
                value={passwordLogin}
                onChange={(event) => onPassword(event.target.value)}
                placeholder="password"
                autoComplete="current-password"
              />
            </label>
            <button className="login-submit" disabled={authPending}>
              <UserRound size={18} />
              {authPending ? "Signing in..." : "Sign in"}
            </button>
            <button
              className="login-button google-login"
              type="button"
              onClick={onSignIn}
              disabled={authPending}
            >
              <Globe2 size={18} />
              Gmail
            </button>
          </form>
        )}
      </div>
    </header>
  );
}

interface DashboardProps {
  filteredPublishers: Publisher[];
  contentSource: PaperLoopContent["source"];
  contentStatus: "loading" | "ready" | "error";
  search: string;
  language: string;
  state: string;
  city: string;
  topic: string;
  languageOptions: string[];
  stateOptions: string[];
  cityOptions: string[];
  topicOptions: string[];
  onSearch: (value: string) => void;
  onLanguage: (value: string) => void;
  onState: (value: string) => void;
  onCity: (value: string) => void;
  onTopic: (value: string) => void;
  onOpenReader: (publisher: Publisher) => void;
}

function Dashboard({
  filteredPublishers,
  contentSource,
  contentStatus,
  search,
  language,
  state,
  city,
  topic,
  languageOptions,
  stateOptions,
  cityOptions,
  topicOptions,
  onSearch,
  onLanguage,
  onState,
  onCity,
  onTopic,
  onOpenReader,
}: DashboardProps) {
  const leadingPublishers = filteredPublishers.filter((publisher) => publisher.isLeading);
  const regionalPublishers = filteredPublishers.filter((publisher) => !publisher.isLeading);
  const featuredPublisher = filteredPublishers[0] ?? mockContent.publishers[0];

  return (
    <section className="page-grid dashboard-grid">
      <div className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">India/Hindi-first digital newspaper network</span>
          <h1>Read the full paper. Open every story. Join the subscriber discussion.</h1>
          <p>
            PaperLoop brings e-paper pages, article posts, columnist profiles, and
            publisher analytics into one responsive React + Firebase platform.
          </p>
          <div className={`data-source ${contentStatus}`}>
            <ShieldCheck size={16} />
            <span>
              {contentStatus === "loading"
                ? "Loading newspaper data"
                : contentStatus === "error"
                  ? "Firestore unavailable; showing demo data"
                  : contentSource === "firestore"
                    ? "Live Firestore content"
                    : "Demo content until Firestore is seeded"}
            </span>
          </div>
          <div className="hero-actions">
            <button onClick={() => onOpenReader(featuredPublisher)}>
              <BookOpen size={18} />
              Open today's edition
            </button>
            <a href="#newspapers">
              <Search size={18} />
              Find newspapers
            </a>
          </div>
        </div>
        <div className="newspaper-preview" aria-label="Digital newspaper preview">
          <div className="paper-masthead">Narmada Times</div>
          <div className="paper-main-story" />
          <div className="paper-columns">
            <span />
            <span />
            <span />
          </div>
          <div className="paper-ad">Digital ad</div>
          <div className="paper-footer" />
        </div>
      </div>

      <div className="stat-strip" aria-label="Platform highlights">
        <Stat icon={<Newspaper size={32} />} label="Publishers" value="42 pilot-ready" />
        <Stat icon={<Users size={32} />} label="Subscribers" value="48K demo cohort" />
        <Stat icon={<Share2 size={32} />} label="Social reach" value="1.2M tracked clicks" />
        <Stat icon={<CircleDollarSign size={32} />} label="Revenue" value="Subscriptions + ads" />
      </div>

      <section className="workspace-panel" id="newspapers">
        <div className="section-heading">
          <span className="eyebrow">Newspaper discovery</span>
          <h2>Leading papers and local editions</h2>
        </div>

        <div className="filters">
          <label className="search-box">
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search newspaper, city, or topic"
            />
          </label>
          <SelectFilter
            icon={<Filter size={18} />}
            label="Language"
            value={language}
            values={languageOptions}
            onChange={onLanguage}
          />
          <SelectFilter
            icon={<Globe2 size={18} />}
            label="State"
            value={state}
            values={stateOptions}
            onChange={onState}
          />
          <SelectFilter
            icon={<MapPin size={18} />}
            label="City"
            value={city}
            values={cityOptions}
            onChange={onCity}
            disabled={state === "All"}
          />
          <SelectFilter
            icon={<Sparkles size={18} />}
            label="Topic"
            value={topic}
            values={topicOptions}
            onChange={onTopic}
          />
        </div>

        <PublisherSection
          title="Leading newspapers"
          publishers={leadingPublishers}
          emptyLabel="No leading newspapers match these filters."
          onOpenReader={onOpenReader}
        />
        <PublisherSection
          title="Regional discovery"
          publishers={regionalPublishers}
          emptyLabel="No regional newspapers match these filters."
          onOpenReader={onOpenReader}
        />
      </section>
    </section>
  );
}

interface SelectFilterProps {
  icon: ReactNode;
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

function SelectFilter({
  icon,
  label,
  value,
  values,
  onChange,
  disabled = false,
}: SelectFilterProps) {
  return (
    <label className={`select-filter${disabled ? " is-disabled" : ""}`}>
      {icon}
      <span className="sr-only">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {values.map((filterValue) => (
          <option key={filterValue} value={filterValue}>
            {filterValue}
          </option>
        ))}
      </select>
    </label>
  );
}

interface PublisherSectionProps {
  title: string;
  publishers: Publisher[];
  emptyLabel: string;
  onOpenReader: (publisher: Publisher) => void;
}

function PublisherSection({
  title,
  publishers: sectionPublishers,
  emptyLabel,
  onOpenReader,
}: PublisherSectionProps) {
  return (
    <section className="publisher-section">
      <h3>{title}</h3>
      {sectionPublishers.length === 0 ? (
        <p className="empty-state">{emptyLabel}</p>
      ) : (
        <div className="publisher-grid">
          {sectionPublishers.map((publisher) => (
            <article className="publisher-card" key={publisher.id}>
              <div className="publisher-logo">{publisher.logo}</div>
              <div className="publisher-meta">
                <strong>{publisher.name}</strong>
                <span>
                  {publisher.city}, {publisher.region}
                </span>
                <div className="topic-row">
                  {publisher.topics.map((publisherTopic) => (
                    <span key={publisherTopic}>{publisherTopic}</span>
                  ))}
                </div>
              </div>
              <div className="score-stack">
                <span>{publisher.language}</span>
                <strong>{publisher.popularityScore}%</strong>
                <small>social rank</small>
              </div>
              <div className="publisher-signals" aria-label="Reader signals">
                <span>
                  <Bookmark size={14} />
                  {compactNumber(publisher.bookmarkCount)}
                </span>
                <span>
                  <Sparkles size={14} />
                  {compactNumber(publisher.likeCount)}
                </span>
              </div>
              <button onClick={() => onOpenReader(publisher)}>
                <BookOpen size={18} />
                Read
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

interface ReaderViewProps {
  articles: ArticlePost[];
  authUser: User | null;
  profile: UserProfile | null;
  userAccess: UserAccess;
  publisher: Publisher;
  edition: Edition;
  editions: Edition[];
  trendingPublishers: Publisher[];
  readerLanguage: string;
  readerState: string;
  readerCity: string;
  readerLanguageOptions: string[];
  readerStateOptions: string[];
  readerCityOptions: string[];
  pageIndex: number;
  zoom: number;
  readerMode: boolean;
  onReaderLanguage: (value: string) => void;
  onReaderState: (value: string) => void;
  onReaderCity: (value: string) => void;
  onSelectPublisher: (publisherId: string) => void;
  onPageIndex: (value: number) => void;
  onZoom: (value: number) => void;
  onReaderMode: (value: boolean) => void;
  onEditionId: (value: string) => void;
  onOpenArticle: (articleId: string) => void;
}

interface TrendingPublisherCarouselProps {
  publishers: Publisher[];
  selectedPublisherId: string;
  onSelect: (publisherId: string) => void;
}

function TrendingPublisherCarousel({
  publishers,
  selectedPublisherId,
  onSelect,
}: TrendingPublisherCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  function scrollCarousel(direction: "left" | "right") {
    trackRef.current?.scrollBy({
      left: direction === "left" ? -280 : 280,
      behavior: "smooth",
    });
  }

  return (
    <section className="reader-carousel" aria-label="Trending newspapers">
      <div className="reader-carousel-header">
        <div>
          <span className="eyebrow">Most followed</span>
          <h3>Trending newspapers</h3>
        </div>
        <div className="reader-carousel-controls">
          <button
            type="button"
            aria-label="Scroll trending newspapers left"
            onClick={() => scrollCarousel("left")}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            aria-label="Scroll trending newspapers right"
            onClick={() => scrollCarousel("right")}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {publishers.length === 0 ? (
        <p className="empty-state reader-carousel-empty">
          No newspapers match these filters yet.
        </p>
      ) : (
        <div className="reader-carousel-track" ref={trackRef}>
          {publishers.map((item, index) => (
            <button
              type="button"
              key={item.id}
              className={`reader-carousel-card${item.id === selectedPublisherId ? " active" : ""}`}
              onClick={() => onSelect(item.id)}
            >
              <div className="reader-carousel-card-head">
                <div className="reader-carousel-card-main">
                  <div className="publisher-logo">{item.logo}</div>
                  <div className="reader-carousel-copy">
                    <div className="reader-carousel-title-row">
                      <strong>{item.name}</strong>
                      {item.isLeading && (
                        <span className="reader-carousel-badge">
                          <TrendingUp size={12} />
                          Trending
                        </span>
                      )}
                    </div>
                    <span>
                      {item.city} • {item.language}
                    </span>
                    <small>
                      <Users size={12} />
                      {compactNumber(item.subscriberCount)} followers
                    </small>
                  </div>
                </div>
                <span className="reader-carousel-rank">#{index + 1}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ReaderView({
  articles,
  authUser,
  profile,
  userAccess,
  publisher,
  edition,
  editions,
  trendingPublishers,
  readerLanguage,
  readerState,
  readerCity,
  readerLanguageOptions,
  readerStateOptions,
  readerCityOptions,
  pageIndex,
  zoom,
  readerMode,
  onReaderLanguage,
  onReaderState,
  onReaderCity,
  onSelectPublisher,
  onPageIndex,
  onZoom,
  onReaderMode,
  onEditionId,
  onOpenArticle,
}: ReaderViewProps) {
  const page = edition.pages[pageIndex] ?? edition.pages[0];
  const canReadSelectedEdition = canReadEdition(edition, profile, userAccess);
  const pageArticles = articles.filter(
    (article) => page && article.pageId === page.id && canReadArticle(article, profile, userAccess),
  );
  const editionPageSummaries = edition.pages.map((editionPage, index) => {
    const readableArticles = articles.filter(
      (article) =>
        article.pageId === editionPage.id && canReadArticle(article, profile, userAccess),
    );

    return {
      page: editionPage,
      index,
      articleCount: readableArticles.length,
      impressions: readableArticles.reduce(
        (sum, article) => sum + article.stats.views,
        0,
      ),
      likes: readableArticles.reduce(
        (sum, article) => sum + (article.stats.likes ?? 0),
        0,
      ),
      comments: readableArticles.reduce(
        (sum, article) => sum + article.stats.comments,
        0,
      ),
      shares: readableArticles.reduce(
        (sum, article) => sum + article.stats.shares,
        0,
      ),
    };
  });
  const pageHotspots = useMemo(() => {
    if (!page) {
      return [];
    }

    const articleHotspots = pageArticles
      .filter(
        (article) =>
          article.blockGeometry &&
          !page.hotspots.some((hotspot) => hotspot.articleId === article.id),
      )
      .map((article) => ({
        id: `article-${article.id}`,
        articleId: article.id,
        label: article.section,
        x: article.blockGeometry!.x,
        y: article.blockGeometry!.y,
        width: article.blockGeometry!.width,
        height: article.blockGeometry!.height,
      }));

    return [...page.hotspots, ...articleHotspots];
  }, [page, pageArticles]);
  const hasPages = edition.pages.length > 0;
  const hasPageImage = Boolean(page?.imageUrl);

  return (
    <section className="reader-layout">
      <header className="reader-discovery workspace-panel">
        <div className="reader-discovery-heading">
          <span className="eyebrow">E-paper reader</span>
          <h2>Pick a trending paper and read page by page</h2>
          <p>
            Filter by state, city, and language, then open clipped stories with live
            impressions and subscriber discussion.
          </p>
        </div>

        <div className="reader-filters">
          <SelectFilter
            icon={<Filter size={18} />}
            label="Language"
            value={readerLanguage}
            values={readerLanguageOptions}
            onChange={onReaderLanguage}
          />
          <SelectFilter
            icon={<Globe2 size={18} />}
            label="State"
            value={readerState}
            values={readerStateOptions}
            onChange={onReaderState}
          />
          <SelectFilter
            icon={<MapPin size={18} />}
            label="City"
            value={readerCity}
            values={readerCityOptions}
            onChange={onReaderCity}
            disabled={readerState === "All"}
          />
        </div>

        <TrendingPublisherCarousel
          publishers={trendingPublishers}
          selectedPublisherId={publisher.id}
          onSelect={onSelectPublisher}
        />
      </header>

      <div className="reader-workspace">
        <div className="reader-main">
          <div className="reader-control-bar">
            <div className="reader-control-group">
              <span className="eyebrow">Now reading</span>
              <strong>{publisher.name}</strong>
              <span>
                {publisher.city} • {edition.date}
              </span>
              {authUser && (
                <span className="access-chip">
                  {hasPublisherSubscription(userAccess, publisher.id)
                    ? "Subscriber access"
                    : canManagePublisher(profile, userAccess, publisher.id)
                      ? "Publisher staff"
                      : "Reader access"}
                </span>
              )}
            </div>

            <label className="edition-select compact">
              <span>Edition</span>
              <select
                value={edition.id}
                onChange={(event) => onEditionId(event.target.value)}
              >
                {editions.length === 0 ? (
                  <option value={edition.id}>{edition.title}</option>
                ) : (
                  editions.map((publisherEdition) => (
                    <option key={publisherEdition.id} value={publisherEdition.id}>
                      {publisherEdition.title} • {publisherEdition.date} •{" "}
                      {formatRole(publisherEdition.status)}
                    </option>
                  ))
                )}
              </select>
            </label>

            <div className="edition-controls">
              <button
                onClick={() => onPageIndex(Math.max(0, pageIndex - 1))}
                disabled={!hasPages || pageIndex === 0}
                aria-label="Previous page"
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                Page {page?.pageNumber ?? 0} of {Math.max(edition.pages.length, 1)}
              </span>
              <button
                onClick={() =>
                  onPageIndex(Math.min(edition.pages.length - 1, pageIndex + 1))
                }
                disabled={!hasPages || pageIndex === edition.pages.length - 1}
                aria-label="Next page"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="tool-row">
              <button onClick={() => onZoom(Math.max(0.85, zoom - 0.1))} aria-label="Zoom out">
                <ZoomOut size={18} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button onClick={() => onZoom(Math.min(1.25, zoom + 0.1))} aria-label="Zoom in">
                <ZoomIn size={18} />
              </button>
              <button onClick={() => onZoom(1)} aria-label="Fit page">
                <Fullscreen size={18} />
              </button>
              <button
                className={readerMode ? "active" : ""}
                onClick={() => onReaderMode(!readerMode)}
                aria-pressed={readerMode}
              >
                Reader mode
              </button>
            </div>
          </div>

          {!canReadSelectedEdition && (
            <section className="locked-panel" role="status">
              <Lock size={22} />
              <div>
                <strong>Subscriber edition</strong>
                <p>
                  Sign in with an eligible subscription or publisher staff account to read
                  this edition.
                </p>
              </div>
            </section>
          )}

          <div className="viewer-toolbar">
            <div>
              <span className="eyebrow">Full-page e-paper</span>
              <h1>{page?.headline ?? edition.title}</h1>
            </div>
            <div className="viewer-actions">
              <button type="button">
                <Bookmark size={18} />
                Save edition
              </button>
              <button type="button">
                <Share2 size={18} />
                Share page
              </button>
            </div>
          </div>

          {hasPages && page && (
            <div className="reader-page-sections">
              {edition.pages.map((editionPage, index) => (
                <button
                  type="button"
                  className={index === pageIndex ? "active" : ""}
                  key={editionPage.id}
                  onClick={() => onPageIndex(index)}
                >
                  {editionPage.section}
                </button>
              ))}
            </div>
          )}

          <div
            className={`paper-stage ${readerMode ? "reader-mode" : ""}${hasPageImage ? " has-page-image" : ""}`}
          >
            {hasPages && page ? (
              <div
                className={`reader-page-stage${hasPageImage ? " has-image" : ""}`}
                style={{ transform: `scale(${zoom})` }}
              >
                {hasPageImage ? (
                  <img
                    src={page.imageUrl}
                    alt={`${publisher.name} page ${page.pageNumber} - ${page.section}`}
                  />
                ) : (
                  <div className="reader-page-placeholder">
                    <span className="eyebrow">
                      {publisher.name} • Page {page.pageNumber}
                    </span>
                    <strong>{page.headline}</strong>
                    <p>{page.subhead}</p>
                    <p className="reader-page-placeholder-note">
                      Page preview is still processing. Use the story list on the right to
                      open available clips.
                    </p>
                  </div>
                )}
                {pageHotspots.map((hotspot) => (
                  <button
                    type="button"
                    className="hotspot"
                    key={hotspot.id}
                    style={{
                      left: `${hotspot.x}%`,
                      top: `${hotspot.y}%`,
                      width: `${hotspot.width}%`,
                      height: `${hotspot.height}%`,
                    }}
                    onClick={() => onOpenArticle(hotspot.articleId)}
                  >
                    <span>{hotspot.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-reader-page">
                <Newspaper size={36} />
                <strong>Edition pages are not ready yet</strong>
                <p>
                  Publisher staff can generate readable page previews from the Admin workspace
                  before this edition opens in the reader.
                </p>
              </div>
            )}
          </div>
        </div>

        <aside className="reader-posts-panel">
          <div className="section-heading compact">
            <span className="eyebrow">Page {page?.pageNumber ?? 0}</span>
            <h2>{page?.section ?? "Sections"}</h2>
            <p>Stories and clips from the page you are viewing.</p>
          </div>

          {editionPageSummaries.length > 0 && (
            <div className="reader-page-list">
              {editionPageSummaries.map((summary) => (
                <article
                  className={`reader-page-card${summary.index === pageIndex ? " active" : ""}`}
                  key={summary.page.id}
                >
                  <div>
                    <span>Page {summary.page.pageNumber}</span>
                    <strong>{summary.page.section}</strong>
                  </div>
                  <div className="reader-post-metrics">
                    <span>
                      <Newspaper size={14} />
                      {summary.articleCount} clips
                    </span>
                    <span>
                      <Eye size={14} />
                      {summary.impressions.toLocaleString()} impressions
                    </span>
                    <span>
                      <Heart size={14} />
                      {summary.likes.toLocaleString()} likes
                    </span>
                    <span>
                      <MessageCircle size={14} />
                      {summary.comments.toLocaleString()} comments
                    </span>
                    <span>
                      <Share2 size={14} />
                      {summary.shares.toLocaleString()} shares
                    </span>
                  </div>
                  <button type="button" onClick={() => onPageIndex(summary.index)}>
                    Read page
                  </button>
                </article>
              ))}
            </div>
          )}

          <div className="reader-post-list">
            {pageArticles.length === 0 ? (
              <div className="empty-article-card">
                <Sparkles size={20} />
                <strong>Clips coming next</strong>
                <p>
                  Published preview pages are readable now. Editors add clickable story
                  blocks and discussion threads in the clipping workflow.
                </p>
              </div>
            ) : (
              pageArticles.map((article) => (
                <button
                  type="button"
                  className="reader-post-card"
                  key={article.id}
                  onClick={() => onOpenArticle(article.id)}
                >
                  <span>{article.section}</span>
                  <strong>{article.title}</strong>
                  <p>{article.summary}</p>
                  <div className="reader-post-metrics">
                    <span>
                      <Eye size={14} />
                      {article.stats.views.toLocaleString()} impressions
                    </span>
                    <span>
                      <MessageCircle size={14} />
                      {article.stats.comments} comments
                    </span>
                    <span>
                      <Heart size={14} />
                      {(article.stats.likes ?? 0).toLocaleString()} likes
                    </span>
                    <span>
                      <Share2 size={14} />
                      {article.stats.shares.toLocaleString()} shares
                    </span>
                  </div>
                  <small>Read this clip and join the discussion</small>
                </button>
              ))
            )}
          </div>

          {authUser ? (
            <p className="reader-post-hint">
              Signed in as {authUser.displayName ?? authUser.email}. Select a story to
              read the full post and comment.
            </p>
          ) : (
            <p className="reader-post-hint">
              Sign in to like, save, and post comments on clipped stories.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

interface ArticleViewProps {
  article: ArticlePost;
  authUser: User | null;
  profile: UserProfile | null;
  userAccess: UserAccess;
  onBack: () => void;
  onAuthRequired: () => void;
}

interface ArticleRouteProps {
  articles: ArticlePost[];
  authUser: User | null;
  profile: UserProfile | null;
  userAccess: UserAccess;
  onAuthRequired: () => void;
}

interface PublisherClipDetailRouteProps {
  articles: ArticlePost[];
  authUser: User | null;
  profile: UserProfile | null;
  publishers: Publisher[];
  userAccess: UserAccess;
}

function PublisherClipDetailRoute({
  articles,
  authUser,
  profile,
  publishers,
  userAccess,
}: PublisherClipDetailRouteProps) {
  const { articleId } = useParams<{ articleId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<PublisherArticlePostDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [article, setArticle] = useState<ArticlePost | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSection, setEditSection] = useState("");
  const [editHotspotLabel, setEditHotspotLabel] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editAccessRule, setEditAccessRule] = useState<AccessRule>("public");
  const [editDiscussionRule, setEditDiscussionRule] =
    useState<DiscussionRule>("logged_in");
  const [editBlockType, setEditBlockType] = useState<ArticleBlockType>("article");
  const [editStatus, setEditStatus] = useState<"idle" | "saving" | "success" | "error">(
    "idle",
  );
  const [editMessage, setEditMessage] = useState("");
  const [clipImageFile, setClipImageFile] = useState<File | null>(null);
  const [clipImageStatus, setClipImageStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [clipImageMessage, setClipImageMessage] = useState("");
  const clipImageInputRef = useRef<HTMLInputElement>(null);
  const fallbackArticle = articles.find((item) => item.id === articleId) ?? null;
  const manageablePublisherIds = useMemo(
    () =>
      canManagePlatform(profile)
        ? publishers.map((publisher) => publisher.id)
        : userAccess.staffPublisherIds,
    [profile, publishers, userAccess.staffPublisherIds],
  );
  const block = detail?.block ?? null;
  const comments = detail?.comments ?? [];
  const engagements = detail?.engagements ?? [];

  function returnToEditionStudio(post: ArticlePost) {
    writeEditionStudioContext(articleStudioContext(post));
    navigate(EDITION_STUDIO_PATH);
  }

  useEffect(() => {
    let active = true;

    if (!articleId || !canOpenAdminWorkspace(profile, userAccess)) {
      return undefined;
    }

    setStatus("loading");
    setDetail(null);

    getPublisherArticlePostDetail(articleId, manageablePublisherIds)
      .then((nextDetail) => {
        if (!active) {
          return;
        }

        if (nextDetail) {
          setDetail(nextDetail);
          setStatus("ready");
          return;
        }

        if (
          fallbackArticle &&
          manageablePublisherIds.some((publisherId) =>
            samePublisherId(publisherId, fallbackArticle.publisherId),
          )
        ) {
          setDetail({
            article: fallbackArticle,
            block: null,
            comments: [],
            engagements: [],
          });
          setStatus("ready");
          return;
        }

        setDetail(null);
        setStatus("error");
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setDetail(null);
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [articleId, fallbackArticle, manageablePublisherIds, profile, userAccess]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    const nextArticle = detail.article;

    setArticle(nextArticle);
    setEditTitle(nextArticle.title);
    setEditSection(nextArticle.section);
    setEditSummary(nextArticle.summary);
    setEditBody(nextArticle.body);
    setEditAccessRule(nextArticle.accessRule);
    setEditDiscussionRule(nextArticle.discussionRule);
    setEditBlockType(detail.block?.type ?? "article");
    setEditHotspotLabel(nextArticle.title);
    setEditStatus("idle");
    setEditMessage("");
    setClipImageFile(null);
    setClipImageStatus("idle");
    setClipImageMessage("");
    if (clipImageInputRef.current) {
      clipImageInputRef.current.value = "";
    }

    let active = true;

    getEditionById(nextArticle.editionId).then((edition) => {
      if (!active || !edition) {
        return;
      }

      setEditHotspotLabel(getHotspotLabelForArticle(edition, nextArticle));
    });

    return () => {
      active = false;
    };
  }, [detail]);

  async function handlePostUpdate(regenerateClipImage = false) {
    if (!authUser || !article || !block) {
      setEditStatus("error");
      setEditMessage("Sign in and link this post to a saved clip before updating.");
      return;
    }

    setEditStatus("saving");
    setEditMessage("");

    try {
      const geometry = normalizeBlockGeometry(block);
      const result = await updatePublisherArticlePost(
        {
          articleId: article.id,
          editionId: article.editionId,
          pageId: article.pageId,
          blockId: block.id,
          type: editBlockType,
          title: editTitle,
          section: editSection,
          summary: editSummary,
          body: editBody,
          authorName: article.author.name,
          accessRule: editAccessRule,
          discussionRule: editDiscussionRule,
          hotspotLabel: editHotspotLabel,
          regenerateClipImage,
          ...geometry,
        },
        authUser,
      );

      setDetail((currentDetail) =>
        currentDetail
          ? {
              ...currentDetail,
              article: result.article,
              block: result.block ?? currentDetail.block,
            }
          : currentDetail,
      );
      setArticle(result.article);
      setEditHotspotLabel(getHotspotLabelForArticle(result.edition, result.article));
      setEditStatus("success");
      setEditMessage(
        regenerateClipImage
          ? "Post and clip image updated."
          : "Post details updated.",
      );
    } catch (error) {
      setEditStatus("error");
      setEditMessage(
        error instanceof Error ? error.message : "Unable to update this post.",
      );
    }
  }

  function handleClipImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setClipImageFile(nextFile);
    setClipImageStatus("idle");
    setClipImageMessage("");
  }

  async function handleClipImageUpload() {
    if (!authUser || !article || !clipImageFile) {
      setClipImageStatus("error");
      setClipImageMessage("Choose an image file before uploading.");
      return;
    }

    setClipImageStatus("uploading");
    setClipImageMessage("");

    try {
      const result = await uploadPublisherClipImage(
        {
          articleId: article.id,
          editionId: article.editionId,
          pageId: article.pageId,
          publisherId: article.publisherId,
          blockId: block?.id,
          imageFile: clipImageFile,
        },
        authUser,
      );

      setDetail((currentDetail) =>
        currentDetail
          ? {
              ...currentDetail,
              article: result.article,
              block: result.block ?? currentDetail.block,
            }
          : currentDetail,
      );
      setArticle(result.article);
      setClipImageFile(null);
      if (clipImageInputRef.current) {
        clipImageInputRef.current.value = "";
      }
      setClipImageStatus("success");
      setClipImageMessage("Clip image replaced.");
    } catch (error) {
      setClipImageStatus("error");
      setClipImageMessage(
        error instanceof Error ? error.message : "Unable to upload this clip image.",
      );
    }
  }

  if (!canOpenAdminWorkspace(profile, userAccess)) {
    return (
      <section className="admin-layout">
        <div className="locked-panel">
          <Lock size={24} />
          <div>
            <strong>Publisher authorization required</strong>
            <p>Use an assigned publisher staff account to inspect clip engagement.</p>
          </div>
        </div>
      </section>
    );
  }

  if (status === "loading") {
    return (
      <section className="admin-layout">
        <p className="empty-state">Loading clip post...</p>
      </section>
    );
  }

  if (!detail || !article) {
    return (
      <section className="admin-layout">
        <button className="back-button" onClick={() => navigate(EDITION_STUDIO_PATH)}>
          <ArrowLeft size={18} />
          Back to edition studio
        </button>
        <p className="empty-state">Clip post not found for this publisher workspace.</p>
      </section>
    );
  }

  const engagementCounts = countEngagements(article, engagements, comments);
  const publisher = publishers.find((item) => item.id === article.publisherId);
  const visibleEngagementEvents = engagements.length
    ? engagements.slice(0, 20).map((event) => ({
        id: event.id,
        label: formatRole(event.type),
        actor: event.userId ?? "reader",
        date: formatActivityDate(event.createdAt),
      }))
    : buildEngagementSummaryEvents(engagementCounts);

  return (
    <section className="admin-layout clip-detail-layout">
      <button className="back-button" onClick={() => returnToEditionStudio(article)}>
        <ArrowLeft size={18} />
        Back to edition studio
      </button>

      <div className="admin-hero compact">
        <span className="eyebrow">Publisher clip detail</span>
        <h1>{article.title}</h1>
        <p>
          {publisher?.name ?? article.publisherId} • Page {article.pageNumber} •{" "}
          {article.section}
        </p>
      </div>

      <div className="clip-detail-grid">
        <section className="workspace-panel clip-post-editor">
          <div className="section-heading compact">
            <span className="eyebrow">Publisher tools</span>
            <h2>Edit post &amp; clip</h2>
          </div>

          {article.clippedImageUrl ? (
            <figure className="article-clip-image clip-detail-preview">
              <img src={article.clippedImageUrl} alt={article.title} />
              <figcaption>Current clipped image</figcaption>
            </figure>
          ) : (
            <div className={`clip-visual clip-detail-preview ${article.clippedImageTone}`}>
              <span>{article.section}</span>
            </div>
          )}

          <form
            className="article-block-form compact"
            onSubmit={(event) => {
              event.preventDefault();
              void handlePostUpdate(false);
            }}
          >
            <div className="clip-image-upload">
              <label>
                <span>Replace clip image</span>
                <input
                  ref={clipImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={clipImageStatus === "uploading"}
                  onChange={handleClipImageFileChange}
                />
              </label>
              {clipImageFile && (
                <p className="clip-image-file-name">Selected: {clipImageFile.name}</p>
              )}
              <div className="clip-image-upload-actions">
                <button
                  type="button"
                  disabled={!clipImageFile || clipImageStatus === "uploading"}
                  onClick={() => void handleClipImageUpload()}
                >
                  <FileUp size={16} />
                  {clipImageStatus === "uploading" ? "Uploading..." : "Upload & replace image"}
                </button>
              </div>
              {clipImageMessage && (
                <p className={`action-feedback ${clipImageStatus}`}>{clipImageMessage}</p>
              )}
            </div>

            <div className="form-grid">
              <label>
                <span>Type</span>
                <select
                  value={editBlockType}
                  onChange={(event) =>
                    setEditBlockType(event.target.value as ArticleBlockType)
                  }
                  disabled={!block || editStatus === "saving"}
                >
                  {blockTypes.map((type) => (
                    <option key={type} value={type}>
                      {formatRole(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Section</span>
                <input
                  value={editSection}
                  onChange={(event) => setEditSection(event.target.value)}
                  disabled={editStatus === "saving"}
                />
              </label>
              <label>
                <span>Title</span>
                <input
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  disabled={editStatus === "saving"}
                />
              </label>
              <label>
                <span>Hotspot label</span>
                <input
                  value={editHotspotLabel}
                  onChange={(event) => setEditHotspotLabel(event.target.value)}
                  disabled={editStatus === "saving"}
                />
              </label>
              <label className="studio-field-wide">
                <span>Summary</span>
                <textarea
                  value={editSummary}
                  onChange={(event) => setEditSummary(event.target.value)}
                  rows={3}
                  disabled={editStatus === "saving"}
                />
              </label>
              <label className="studio-field-wide">
                <span>Body</span>
                <textarea
                  value={editBody}
                  onChange={(event) => setEditBody(event.target.value)}
                  rows={4}
                  disabled={editStatus === "saving"}
                />
              </label>
            </div>
            <div className="published-post-links">
              <a
                className="text-link-btn"
                href={`/article/${article.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
                Preview as reader
              </a>
            </div>
            <div className="section-panel-actions">
              <button type="submit" disabled={editStatus === "saving" || !block}>
                {editStatus === "saving" ? "Saving..." : "Save post changes"}
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={editStatus === "saving" || !block}
                onClick={() => void handlePostUpdate(true)}
              >
                Regenerate from page
              </button>
            </div>
            {editMessage && <p className={`action-feedback ${editStatus}`}>{editMessage}</p>}
            {!block && (
              <p className="clip-post-empty">
                This post is not linked to a saved clip block, so rectangle and image updates are
                unavailable here. Edit it from edition studio instead.
              </p>
            )}
          </form>
        </section>

        <aside className="workspace-panel clip-detail-card">
          <div className="section-heading compact">
            <span className="eyebrow">Engagement</span>
            <h2>Reader activity</h2>
          </div>
          <div className="clip-detail-metrics">
            <article>
              <Heart size={18} />
              <strong>{engagementCounts.likes.toLocaleString()}</strong>
              <span>Likes</span>
            </article>
            <article>
              <Bookmark size={18} />
              <strong>{engagementCounts.saves.toLocaleString()}</strong>
              <span>Saves</span>
            </article>
            <article>
              <Share2 size={18} />
              <strong>{engagementCounts.shares.toLocaleString()}</strong>
              <span>Shares</span>
            </article>
            <article>
              <MessageCircle size={18} />
              <strong>{engagementCounts.comments.toLocaleString()}</strong>
              <span>Comments</span>
            </article>
          </div>
          <div className="clip-schema-note">
            <strong>Collection links</strong>
            <p>
              Comments and engagement events are stored separately and linked through
              publisherId, editionId, pageId, and articlePostId.
            </p>
          </div>
          {block && (
            <div className="clip-schema-note">
              <strong>Page rectangle</strong>
              <p>
                {block.label}: x {block.x}%, y {block.y}%, width {block.width}%,
                height {block.height}%.
              </p>
            </div>
          )}
        </aside>
      </div>

      <div className="clip-activity-grid">
        <section className="workspace-panel">
          <div className="section-heading compact">
            <span className="eyebrow">Comments</span>
            <h2>Reader discussion</h2>
          </div>
          <div className="comment-list">
            {comments.length === 0 ? (
              <p className="empty-state">No comments recorded for this clip yet.</p>
            ) : (
              comments.map((comment) => (
                <article className="comment-card" key={comment.id}>
                  <div>
                    <strong>{comment.userName}</strong>
                    <span>{formatActivityDate(comment.createdAt)}</span>
                  </div>
                  <p>{comment.body}</p>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="workspace-panel">
          <div className="section-heading compact">
            <span className="eyebrow">Events</span>
            <h2>Likes, saves, shares, and reports</h2>
          </div>
          <div className="engagement-event-list">
            {visibleEngagementEvents.length === 0 ? (
              <p className="empty-state">No engagement events recorded yet.</p>
            ) : (
              visibleEngagementEvents.map((event) => (
                <article key={event.id}>
                  <span>{event.label}</span>
                  <strong>{event.actor}</strong>
                  <small>{event.date}</small>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function ArticleRoute({
  articles,
  authUser,
  profile,
  userAccess,
  onAuthRequired,
}: ArticleRouteProps) {
  const { articleId } = useParams<{ articleId: string }>();
  const navigate = useNavigate();
  const article = articles.find((item) => item.id === articleId);

  if (!article) {
    return (
      <section className="article-layout">
        <p className="empty-state">Article not found.</p>
        <button type="button" onClick={() => navigate("/reader")}>
          Back to reader
        </button>
      </section>
    );
  }

  return (
    <ArticleView
      key={article.id}
      article={article}
      authUser={authUser}
      profile={profile}
      userAccess={userAccess}
      onBack={() => navigate("/reader")}
      onAuthRequired={onAuthRequired}
    />
  );
}

function ArticleView({
  article,
  authUser,
  profile,
  userAccess,
  onBack,
  onAuthRequired,
}: ArticleViewProps) {
  const [comments, setComments] = useState<Comment[]>(() => article.comments);
  const [commentBody, setCommentBody] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pendingAction, setPendingAction] = useState<EngagementType | "post" | "">("");
  const canReadSelectedArticle = canReadArticle(article, profile, userAccess);
  const canJoinDiscussion = canUseDiscussion(article, profile, userAccess);

  async function handleEngagement(type: EngagementType) {
    if (!authUser) {
      onAuthRequired();
      return;
    }

    if (!canReadSelectedArticle) {
      setFeedback("This action needs an active subscription or publisher staff access.");
      return;
    }

    setFeedback("");
    setPendingAction(type);

    try {
      await recordEngagement({
        article,
        type,
        user: authUser,
        metadata: { source: "article_detail" },
      });

      setFeedback(`${capitalize(type)} recorded for this article.`);
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Unable to record this action.",
      );
    } finally {
      setPendingAction("");
    }
  }

  async function handleCommentSubmit() {
    if (!authUser) {
      onAuthRequired();
      return;
    }

    if (!canJoinDiscussion) {
      setFeedback("This discussion is limited to subscribers or publisher staff.");
      return;
    }

    setFeedback("");
    setPendingAction("post");

    try {
      const nextComment = await createArticleComment(article, commentBody, authUser);
      setComments((currentComments) => [nextComment, ...currentComments]);
      setCommentBody("");
      setFeedback("Comment posted to the subscriber discussion.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to post comment.");
    } finally {
      setPendingAction("");
    }
  }

  return (
    <section className="article-layout">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={18} />
        Back to e-paper page {article.pageNumber}
      </button>

      <article className="article-panel">
        {article.clippedImageUrl ? (
          <figure className="article-clip-image">
            <img src={article.clippedImageUrl} alt={article.title} />
            <figcaption>
              Page {article.pageNumber} clipping • {article.section}
            </figcaption>
          </figure>
        ) : (
          <div className={`clip-visual ${article.clippedImageTone}`}>
            <span>{article.section}</span>
          </div>
        )}
        <div className="article-content">
          <div className="article-kicker">
            <span>{article.section}</span>
            {article.accessRule === "subscriber_only" && (
              <span className="lock-chip">
                <Lock size={14} />
                Subscriber
              </span>
            )}
          </div>
          <h1>{article.title}</h1>
          <p className="summary">{article.summary}</p>
          <div className="byline-card">
            <div className="avatar">{article.author.name.slice(0, 1)}</div>
            <div>
              <strong>{article.author.name}</strong>
              <span>
                {article.author.publication} • {article.author.followers.toLocaleString()} followers
              </span>
            </div>
            <button onClick={() => handleEngagement("follow")} disabled={pendingAction === "follow"}>
              <Bell size={18} />
              {pendingAction === "follow" ? "Following..." : "Follow"}
            </button>
          </div>
          {canReadSelectedArticle ? (
            <p>{article.body}</p>
          ) : (
            <div className="locked-panel compact" role="status">
              <Lock size={20} />
              <div>
                <strong>Subscriber-only article</strong>
                <p>
                  Sign in with an active subscription or publisher staff account to read the full story.
                </p>
              </div>
            </div>
          )}
          <div className="engagement-row">
            <button
              onClick={() => handleEngagement("like")}
              disabled={pendingAction === "like" || !canReadSelectedArticle}
            >
              <Heart size={18} />
              {(article.stats.likes ?? 0).toLocaleString()}
            </button>
            <button
              onClick={() => handleEngagement("save")}
              disabled={pendingAction === "save" || !canReadSelectedArticle}
            >
              <Bookmark size={18} />
              {article.stats.saves.toLocaleString()}
            </button>
            <button
              onClick={() => handleEngagement("share")}
              disabled={pendingAction === "share" || !canReadSelectedArticle}
            >
              <Share2 size={18} />
              {article.stats.shares.toLocaleString()}
            </button>
            <button>
              <MessageCircle size={18} />
              {article.stats.comments}
            </button>
            <button
              onClick={() => handleEngagement("report")}
              disabled={pendingAction === "report" || !canReadSelectedArticle}
            >
              <Flag size={18} />
              {pendingAction === "report" ? "Reporting..." : "Report"}
            </button>
          </div>
          {feedback && <p className="action-feedback">{feedback}</p>}
        </div>
      </article>

      <div className="article-side-grid">
        <section className="workspace-panel">
          <div className="section-heading compact">
            <span className="eyebrow">Multimedia enrichment</span>
            <h2>Digital enhancements</h2>
          </div>
          <div className="media-list">
            {article.multimedia.map((block) => (
              <div className="media-card" key={block.title}>
                {block.type === "video" ? <Video size={20} /> : <PlaySquare size={20} />}
                <div>
                  <strong>{block.title}</strong>
                  <p>{block.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="workspace-panel">
          <div className="section-heading compact">
            <span className="eyebrow">Subscriber community</span>
            <h2>Discussion</h2>
          </div>
          <div className="comment-composer">
            <textarea
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              placeholder="Add a subscriber comment"
              disabled={!canJoinDiscussion}
            />
            <button
              onClick={handleCommentSubmit}
              disabled={pendingAction === "post" || !canJoinDiscussion}
            >
              <MessageCircle size={18} />
              {pendingAction === "post" ? "Posting..." : "Post"}
            </button>
          </div>
          {!canJoinDiscussion && (
            <p className="empty-state">
              Subscriber or publisher staff access is required for this discussion.
            </p>
          )}
          <div className="comment-list">
            {comments.length === 0 ? (
              <p className="empty-state">No comments yet. Start the discussion.</p>
            ) : (
              comments.map((comment) => (
                <article className="comment-card" key={comment.id}>
                  <div>
                    <strong>{comment.userName}</strong>
                    <span>{comment.createdAt}</span>
                  </div>
                  <p>{comment.body}</p>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function countEngagements(
  article: ArticlePost,
  engagements: PublisherEngagementActivity[],
  comments: PublisherCommentActivity[],
) {
  const countType = (type: PublisherEngagementActivity["type"]) =>
    engagements.filter((event) => event.type === type).length;

  return {
    likes: Math.max(article.stats.likes ?? 0, countType("like")),
    saves: Math.max(article.stats.saves, countType("save")),
    shares: Math.max(article.stats.shares, countType("share")),
    comments: Math.max(article.stats.comments, comments.length, countType("comment")),
  };
}

function buildEngagementSummaryEvents(counts: {
  likes: number;
  saves: number;
  shares: number;
  comments: number;
}) {
  return [
    { id: "likes-summary", label: "Like", actor: `${counts.likes} reader actions`, date: "Seeded stats" },
    { id: "saves-summary", label: "Save", actor: `${counts.saves} reader actions`, date: "Seeded stats" },
    { id: "shares-summary", label: "Share", actor: `${counts.shares} reader actions`, date: "Seeded stats" },
    { id: "comments-summary", label: "Comment", actor: `${counts.comments} reader actions`, date: "Seeded stats" },
  ].filter((event) => !event.actor.startsWith("0 "));
}

function formatActivityDate(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  if (typeof value === "string" && value !== "Just now") {
    const parsed = Date.parse(value);

    if (Number.isFinite(parsed)) {
      return new Date(parsed).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    }
  }

  return typeof value === "string" ? value : "Recent";
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function socialRankScore(publisher: Publisher) {
  return (
    publisher.popularityScore * 0.4 +
    publisher.relevanceScore * 0.25 +
    (publisher.subscriberCount / 1000) * 0.2 +
    ((publisher.bookmarkCount ?? 0) / 1000) * 0.1 +
    ((publisher.likeCount ?? 0) / 1000) * 0.05
  );
}

function compactNumber(value = 0) {
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function compareEditionsForReader(a: Edition, b: Edition) {
  const statusRank = (edition: Edition) => (edition.status === "published" ? 1 : 0);
  const pageRank = (edition: Edition) => (edition.pages.length > 0 ? 1 : 0);
  const imageRank = (edition: Edition) =>
    edition.pages.some((page) => page.imageUrl || page.thumbnailUrl) ? 1 : 0;

  return (
    imageRank(b) - imageRank(a) ||
    statusRank(b) - statusRank(a) ||
    pageRank(b) - pageRank(a) ||
    b.date.localeCompare(a.date)
  );
}

function readerEditionRank(edition: Edition, articles: ArticlePost[]) {
  const pageImageScore = editionHasReadablePageAsset(edition) ? 10000 : 0;
  const clipScore = articles.filter((article) => article.editionId === edition.id).length * 250;
  const pageScore = edition.pages.length * 20;
  const statusScore = edition.status === "published" ? 100 : 0;
  const dateScore = Date.parse(edition.date) || 0;

  return pageImageScore + clipScore + pageScore + statusScore + dateScore / 100000000000;
}

function editionHasReadablePageAsset(edition: Edition) {
  return edition.pages.some((page) => page.imageUrl || page.thumbnailUrl);
}

function createPlaceholderEdition(publisher: Publisher): Edition {
  return {
    id: `${publisher.id}-placeholder`,
    publisherId: publisher.id,
    title: `${publisher.name} edition`,
    date: publisher.latestEditionDate,
    city: publisher.city,
    language: publisher.language,
    sections: publisher.topics.slice(0, 4),
    status: "review",
    accessRule: "public",
    pages: [],
  };
}

function formatRole(value: string) {
  return value
    .split("_")
    .map((part) => capitalize(part))
    .join(" ");
}

function publisherName(publishers: Publisher[], publisherId: string) {
  return (
    publishers.find((publisher) => publisher.id === publisherId)?.name ?? publisherId
  );
}

function grantAccessCommand(invite: PublisherStaffInvite) {
  return `npm run grant:access -- --email ${invite.email} --publisher ${invite.publisherId} --role ${invite.role} --name "${invite.name}"`;
}

function upsertEdition(editions: Edition[], nextEdition: Edition) {
  const existingEditionIndex = editions.findIndex(
    (edition) => edition.id === nextEdition.id,
  );

  if (existingEditionIndex === -1) {
    return [nextEdition, ...editions];
  }

  return editions.map((edition) =>
    edition.id === nextEdition.id ? nextEdition : edition,
  );
}

function upsertBlock(blocks: ArticleBlock[], nextBlock: ArticleBlock) {
  const existingBlockIndex = blocks.findIndex((block) => block.id === nextBlock.id);

  if (existingBlockIndex === -1) {
    return [nextBlock, ...blocks];
  }

  return blocks.map((block) => (block.id === nextBlock.id ? nextBlock : block));
}

function normalizeBlockGeometry(geometry: BlockGeometry): BlockGeometry {
  const x = Math.min(99, clampPercent(geometry.x));
  const y = Math.min(99, clampPercent(geometry.y));
  const width = Math.max(1, Math.min(clampPercent(geometry.width), 100 - x));
  const height = Math.max(1, Math.min(clampPercent(geometry.height), 100 - y));

  return { x, y, width, height };
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function formatPageClipLabel(pageBlocks: ArticleBlock[]) {
  return `#${pageBlocks.length + 1} clip`;
}

function isGenericClipLabel(label: string) {
  const normalized = label.trim().toLowerCase();

  return normalized === "new clip" || normalized === "manual block";
}

function getHotspotLabelForArticle(edition: Edition | null, article: ArticlePost) {
  const page = edition?.pages.find((pageItem) => pageItem.id === article.pageId);
  const hotspot = page?.hotspots.find((hotspotItem) => hotspotItem.articleId === article.id);

  return hotspot?.label ?? article.title;
}

function buildPublisherStats(
  publishers: Publisher[],
  editions: Edition[],
  articles: ArticlePost[],
  blocks: ArticleBlock[],
  comments: PublisherCommentActivity[],
): MetricCard[] {
  const totalViews = articles.reduce((sum, article) => sum + article.stats.views, 0);
  const totalShares = articles.reduce((sum, article) => sum + article.stats.shares, 0);
  const totalLikes = articles.reduce(
    (sum, article) => sum + (article.stats.likes ?? article.stats.saves),
    0,
  );
  const totalFollowers = articles.reduce(
    (sum, article) => sum + article.author.followers,
    publishers.reduce((publisherSum, publisher) => publisherSum + publisher.subscriberCount, 0),
  );
  const readyEditions = editions.filter((edition) =>
    ["review", "published"].includes(edition.status),
  ).length;

  return [
    {
      label: "Reach",
      value: compactNumber(totalViews + totalShares),
      delta: `${blocks.length} blocks`,
      tone: "good",
    },
    {
      label: "Followers",
      value: compactNumber(totalFollowers),
      delta: `${publishers.length} publisher${publishers.length === 1 ? "" : "s"}`,
      tone: "neutral",
    },
    {
      label: "Likes",
      value: compactNumber(totalLikes),
      delta: `${totalShares.toLocaleString()} shares`,
      tone: "good",
    },
    {
      label: "Viewers",
      value: compactNumber(totalViews),
      delta: `${comments.length} comments`,
      tone: comments.length > 20 ? "warn" : "neutral",
    },
    {
      label: "Editions",
      value: String(readyEditions),
      delta: `${editions.length} total`,
      tone: "neutral",
    },
  ];
}

function publisherMetricVariant(label: string) {
  switch (label) {
    case "Reach":
      return "reach";
    case "Followers":
      return "followers";
    case "Likes":
      return "likes";
    case "Viewers":
      return "viewers";
    case "Editions":
      return "editions";
    default:
      return "reach";
  }
}

function publisherMetricIcon(label: string) {
  switch (label) {
    case "Reach":
      return <TrendingUp size={72} strokeWidth={1.5} aria-hidden="true" />;
    case "Followers":
      return <Users size={72} strokeWidth={1.5} aria-hidden="true" />;
    case "Likes":
      return <Heart size={72} strokeWidth={1.5} aria-hidden="true" />;
    case "Viewers":
      return <Eye size={72} strokeWidth={1.5} aria-hidden="true" />;
    case "Editions":
      return <Newspaper size={72} strokeWidth={1.5} aria-hidden="true" />;
    default:
      return <BarChart3 size={72} strokeWidth={1.5} aria-hidden="true" />;
  }
}

interface AdminViewProps {
  articles: ArticlePost[];
  authUser: User | null;
  campaigns: Campaign[];
  editions: Edition[];
  profile: UserProfile | null;
  publishers: Publisher[];
  userAccess: UserAccess;
}

function AdminView({
  articles,
  authUser,
  campaigns,
  editions,
  profile,
  publishers,
  userAccess,
}: AdminViewProps) {
  const navigate = useNavigate();
  const restoredStudioContext = useMemo(readEditionStudioContext, []);
  const accessiblePublishers = useMemo(
    () =>
      canManagePlatform(profile)
        ? publishers
        : publishers.filter((publisher) =>
            userAccess.staffPublisherIds.includes(publisher.id),
          ),
    [profile, publishers, userAccess.staffPublisherIds],
  );
  const fallbackPublisher = accessiblePublishers[0] ?? publishers[0];
  const [draftPublisherId, setDraftPublisherId] = useState(
    fallbackPublisher?.id ?? "",
  );
  const selectedDraftPublisher =
    accessiblePublishers.find((publisher) => publisher.id === draftPublisherId) ??
    fallbackPublisher;
  const selectedDraftPublisherId = selectedDraftPublisher?.id ?? "";
  const fallbackLocation =
    findLocationByCity(fallbackPublisher?.city, fallbackEditionLocations) ??
    fallbackEditionLocations[0];
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDate, setDraftDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [editionLocations, setEditionLocations] = useState<EditionLocation[]>(
    fallbackEditionLocations,
  );
  const [editionLanguages, setEditionLanguages] = useState<EditionLanguage[]>(
    fallbackEditionLanguages,
  );
  const [draftState, setDraftState] = useState(fallbackLocation?.state ?? "");
  const [draftCity, setDraftCity] = useState(fallbackPublisher?.city ?? "");
  const [draftLanguage, setDraftLanguage] = useState(
    fallbackPublisher?.language ?? "Hindi",
  );
  const [draftAccessRule, setDraftAccessRule] = useState<AccessRule>("public");
  const [draftSections, setDraftSections] = useState("मुख पृष्ठ, शहर");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [createdDrafts, setCreatedDrafts] = useState<Edition[]>([]);
  const [workspaceEditions, setWorkspaceEditions] = useState<Edition[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [workspaceBlocks, setWorkspaceBlocks] = useState<ArticleBlock[]>([]);
  const [workspaceComments, setWorkspaceComments] = useState<PublisherCommentActivity[]>([]);
  const [createdArticles, setCreatedArticles] = useState<ArticlePost[]>([]);
  const [createdCampaigns, setCreatedCampaigns] = useState<Campaign[]>([]);
  const [staffDirectory, setStaffDirectory] = useState<PublisherStaffMembership[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PublisherStaffInvite[]>([]);
  const [accessStatus, setAccessStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [invitePublisherId, setInvitePublisherId] = useState(
    fallbackPublisher?.id ?? "",
  );
  const selectedInvitePublisher =
    accessiblePublishers.find((publisher) => publisher.id === invitePublisherId) ??
    fallbackPublisher;
  const selectedInvitePublisherId = selectedInvitePublisher?.id ?? "";
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<PublisherStaffMembership["role"]>("publisher_admin");
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [inviteMessage, setInviteMessage] = useState("");
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [uploadMessage, setUploadMessage] = useState("");
  const [pageAppendStatus, setPageAppendStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const pageAppendInputRef = useRef<HTMLInputElement>(null);
  const [workflowEditionId, setWorkflowEditionId] = useState("");
  const [workflowStatus, setWorkflowStatus] = useState<"success" | "error">(
    "success",
  );
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [previewEditionId, setPreviewEditionId] = useState(
    restoredStudioContext?.previewEditionId ?? "",
  );
  const [articlePageId, setArticlePageId] = useState(
    restoredStudioContext?.articlePageId ?? "",
  );
  const [articleTitle, setArticleTitle] = useState("");
  const [articleSection, setArticleSection] = useState("शहर");
  const [articleSummary, setArticleSummary] = useState("");
  const [articleBody, setArticleBody] = useState("");
  const [articleAuthorName, setArticleAuthorName] = useState("Publisher Desk");
  const [articleHotspotLabel, setArticleHotspotLabel] = useState("Open story");
  const [articleAccessRule, setArticleAccessRule] = useState<AccessRule>("public");
  const [articleDiscussionRule, setArticleDiscussionRule] =
    useState<DiscussionRule>("logged_in");
  const [articleCreateStatus, setArticleCreateStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [articleCreateMessage, setArticleCreateMessage] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState(
    restoredStudioContext?.selectedBlockId ?? "",
  );
  const [manualClipActive, setManualClipActive] = useState(false);
  const [awaitingClipDraw, setAwaitingClipDraw] = useState(false);
  const [clipExtractStatus, setClipExtractStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [draftClipPreviewUrl, setDraftClipPreviewUrl] = useState("");
  const [blockType, setBlockType] = useState<ArticleBlockType>("article");
  const [blockStatus, setBlockStatus] = useState<ArticleBlockStatus>("draft");
  const [blockLabel, setBlockLabel] = useState("Manual block");
  const [blockX, setBlockX] = useState(8);
  const [blockY, setBlockY] = useState(16);
  const [blockWidth, setBlockWidth] = useState(34);
  const [blockHeight, setBlockHeight] = useState(18);
  const [hideClips, setHideClips] = useState(false);
  const [clipZoom, setClipZoom] = useState(1);
  const [sidebarTab, setSidebarTab] = useState<"pages" | "clips">(
    restoredStudioContext?.sidebarTab ?? "pages",
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sectionPanelOpen, setSectionPanelOpen] = useState(true);
  const [clipDrawMode, setClipDrawMode] = useState(true);
  const [blockSaveStatus, setBlockSaveStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [blockMessage, setBlockMessage] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignAdvertiser, setCampaignAdvertiser] = useState("");
  const [campaignTarget, setCampaignTarget] = useState("");
  const [campaignPlacementTarget, setCampaignPlacementTarget] =
    useState<CampaignInput["placementTarget"]>("publisher");
  const [campaignBudget, setCampaignBudget] = useState("Rs 25K");
  const [campaignStatus, setCampaignStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [campaignMessage, setCampaignMessage] = useState("");
  const [staffActionMessage, setStaffActionMessage] = useState("");
  const draftCityOptions = useMemo(
    () =>
      editionLocations.find((location) => location.state === draftState)?.cities ??
      [],
    [draftState, editionLocations],
  );
  const selectedDraftCity = draftCityOptions.includes(draftCity)
    ? draftCity
    : draftCityOptions[0] ?? draftCity;
  const draftLanguageOptions = useMemo(
    () => editionLanguages.map((languageOption) => languageOption.name),
    [editionLanguages],
  );
  const selectedDraftLanguage = draftLanguageOptions.includes(draftLanguage)
    ? draftLanguage
    : draftLanguageOptions[0] ?? draftLanguage;
  const workspacePublisherIds = useMemo(
    () => accessiblePublishers.map((publisher) => publisher.id),
    [accessiblePublishers],
  );
  const reviewQueue = useMemo(() => {
    const latestEditions = new Map<string, Edition>();

    [
      ...editions.filter((edition) => edition.status !== "published"),
      ...createdDrafts,
      ...workspaceEditions,
    ]
      .filter((edition) => workspacePublisherIds.includes(edition.publisherId))
      .forEach((edition) => latestEditions.set(edition.id, edition));

    return Array.from(latestEditions.values())
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .slice(0, 8);
  }, [createdDrafts, editions, workspaceEditions, workspacePublisherIds]);
  const previewEdition = useMemo(
    () => reviewQueue.find((edition) => edition.id === previewEditionId) ?? null,
    [previewEditionId, reviewQueue],
  );
  const selectedArticlePage =
    previewEdition?.pages.find((page) => page.id === articlePageId) ??
    previewEdition?.pages[0] ??
    null;
  const selectedPageBlocks = useMemo(
    () =>
      selectedArticlePage
        ? workspaceBlocks.filter((block) => block.pageId === selectedArticlePage.id)
        : [],
    [selectedArticlePage, workspaceBlocks],
  );
  const selectedBlock =
    (selectedBlockId
      ? workspaceBlocks.find(
          (block) => block.id === selectedBlockId && block.pageId === selectedArticlePage?.id,
        )
      : null) ?? null;
  const selectedPageIndex =
    previewEdition?.pages.findIndex((page) => page.id === selectedArticlePage?.id) ?? -1;
  const totalPreviewPages = previewEdition?.pages.length ?? 0;
  const hasDraftClipGeometry = blockWidth >= 2 && blockHeight >= 2;
  const activeClipOverlay =
    selectedArticlePage &&
    (selectedBlock || (manualClipActive && hasDraftClipGeometry && !awaitingClipDraw))
      ? {
          id: selectedBlock?.id ?? "manual-draft",
          label: blockLabel,
          x: blockX,
          y: blockY,
          width: blockWidth,
          height: blockHeight,
          isDraft: !selectedBlock,
        }
      : null;
  const currentWorkflowEdition = previewEdition ?? reviewQueue[0] ?? null;
  const currentWorkflowBlocks = currentWorkflowEdition
    ? workspaceBlocks.filter((block) => block.editionId === currentWorkflowEdition.id)
    : [];
  const publisherArticles = useMemo(
    () =>
      [
        ...createdArticles,
        ...articles.filter(
          (article) =>
            !createdArticles.some((createdArticle) => createdArticle.id === article.id),
        ),
      ].filter((article) => workspacePublisherIds.includes(article.publisherId)),
    [articles, createdArticles, workspacePublisherIds],
  );
  const currentWorkflowPosts = currentWorkflowEdition
    ? publisherArticles.filter((article) => article.editionId === currentWorkflowEdition.id)
    : [];
  const selectedClipSavedPost = useMemo(() => {
    if (!selectedBlock) {
      return null;
    }

    if (selectedBlock.articlePostId) {
      return (
        publisherArticles.find((article) => article.id === selectedBlock.articlePostId) ?? null
      );
    }

    return (
      publisherArticles.find((article) => article.sourceBlockId === selectedBlock.id) ?? null
    );
  }, [publisherArticles, selectedBlock]);
  const currentWorkflowHasPages = Boolean(
    currentWorkflowEdition?.pages.some((page) => page.imageUrl),
  );
  const currentWorkflowNextAction = !currentWorkflowEdition
    ? "Upload a PDF or page image to start."
    : currentWorkflowEdition.status === "processing"
      ? "PaperLoop is processing pages and AI blocks. This panel refreshes automatically."
      : !currentWorkflowHasPages
        ? "Run smart processing so pages and AI block suggestions appear."
        : currentWorkflowBlocks.length === 0
          ? "Refresh after processing, or draw a manual block on the page."
          : currentWorkflowPosts.length === 0
            ? "Open Preview, select a block, correct its rectangle/text, then create an article post."
            : "Review saved posts, publish the edition, then readers can open hotspots and engage.";
  const workspaceCampaigns = useMemo(
    () => [
      ...createdCampaigns,
      ...campaigns.filter(
        (campaign) =>
          !createdCampaigns.some((createdCampaign) => createdCampaign.id === campaign.id),
      ),
    ],
    [campaigns, createdCampaigns],
  );
  const activePublisherCampaigns = workspaceCampaigns.filter((campaign) =>
    workspacePublisherIds.includes(campaign.publisherId),
  );
  const dashboardStats = buildPublisherStats(
    accessiblePublishers,
    workspaceEditions,
    publisherArticles,
    workspaceBlocks,
    workspaceComments,
  );

  useEffect(() => {
    if (!previewEditionId || !articlePageId) {
      return;
    }

    writeEditionStudioContext({
      previewEditionId,
      articlePageId,
      selectedBlockId,
      sidebarTab,
    });
  }, [articlePageId, previewEditionId, selectedBlockId, sidebarTab]);

  useEffect(() => {
    let active = true;

    Promise.all([getEditionLocations(), getEditionLanguages()]).then(
      ([locations, languages]) => {
        if (!active) {
          return;
        }

        setEditionLocations(locations);
        setEditionLanguages(languages);
        setLocationDraftFromPublisher(selectedDraftPublisher, locations);
      },
    );

    return () => {
      active = false;
    };
  }, [selectedDraftPublisher]);

  useEffect(() => {
    let active = true;

    Promise.all([
      getPublisherWorkspaceEditions(workspacePublisherIds),
      getPublisherArticleBlocks(workspacePublisherIds),
      getPublisherComments(workspacePublisherIds),
    ])
      .then(([nextEditions, nextBlocks, nextComments]) => {
        if (!active) {
          return;
        }

        setWorkspaceEditions(nextEditions);
        setWorkspaceBlocks(nextBlocks);
        setWorkspaceComments(nextComments);
        setCreatedDrafts((currentDrafts) =>
          currentDrafts
            .map((draft) =>
              nextEditions.find((edition) => edition.id === draft.id) ?? draft,
            )
            .filter((draft) => draft.status !== "published"),
        );
        setWorkspaceStatus("ready");
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setWorkspaceEditions([]);
        setWorkspaceBlocks([]);
        setWorkspaceComments([]);
        setWorkspaceStatus("error");
      });

    return () => {
      active = false;
    };
  }, [workspacePublisherIds, workspaceRefreshKey]);

  useEffect(() => {
    const hasProcessingEdition = reviewQueue.some(
      (edition) => edition.status === "processing",
    );

    if (!hasProcessingEdition) {
      return undefined;
    }

    const refreshTimer = window.setInterval(() => {
      setWorkspaceRefreshKey((currentKey) => currentKey + 1);
    }, 5000);

    return () => window.clearInterval(refreshTimer);
  }, [reviewQueue]);

  useEffect(() => {
    let active = true;

    Promise.all([
      getPublisherStaffDirectory(workspacePublisherIds),
      getPublisherStaffInvites(workspacePublisherIds),
    ])
      .then(([nextStaffDirectory, nextPendingInvites]) => {
        if (!active) {
          return;
        }

        setStaffDirectory(nextStaffDirectory);
        setPendingInvites(nextPendingInvites);
        setAccessStatus("ready");
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setStaffDirectory([]);
        setPendingInvites([]);
        setAccessStatus("error");
      });

    return () => {
      active = false;
    };
  }, [workspacePublisherIds]);

  function publisherPostStudioContext(article: ArticlePost) {
    return previewEditionId === article.editionId
      ? {
          previewEditionId,
          articlePageId: articlePageId || article.pageId,
          selectedBlockId: selectedBlockId || article.sourceBlockId || "",
          sidebarTab: "clips" as const,
        }
      : articleStudioContext(article);
  }

  function openPublisherPostActivity(article: ArticlePost) {
    writeEditionStudioContext(publisherPostStudioContext(article));
    navigate(`${EDITION_STUDIO_PATH}/posts/${article.id}`);
  }

  function hydrateSectionFormFromArticle(article: ArticlePost) {
    setArticleTitle(article.title);
    setArticleSection(article.section);
    setArticleSummary(article.summary);
    setArticleBody(article.body);
    setArticleHotspotLabel(getHotspotLabelForArticle(previewEdition, article));
    setArticleAccessRule(article.accessRule);
    setArticleDiscussionRule(article.discussionRule);

    if (article.blockGeometry) {
      const geometry = normalizeBlockGeometry(article.blockGeometry);

      setBlockX(geometry.x);
      setBlockY(geometry.y);
      setBlockWidth(geometry.width);
      setBlockHeight(geometry.height);
    }
  }

  useEffect(() => {
    if (!selectedClipSavedPost || !selectedBlock || selectedBlock.id !== selectedBlockId) {
      return;
    }

    hydrateSectionFormFromArticle(selectedClipSavedPost);
  }, [selectedBlockId, selectedClipSavedPost?.id]);

  async function handleDraftUpload() {
    if (!authUser || !sourceFile) {
      setUploadStatus("error");
      setUploadMessage("Sign in and choose a PDF or page image before uploading.");
      return;
    }

    setUploadStatus("uploading");
    setUploadMessage("");

    try {
      const nextDraft = await createEditionDraft(
        {
          publisherId: selectedDraftPublisherId,
          publisherName: selectedDraftPublisher?.name ?? selectedDraftPublisherId,
          title: draftTitle,
          date: draftDate,
          state: draftState,
          city: selectedDraftCity,
          language: selectedDraftLanguage,
          accessRule: draftAccessRule,
          sections: draftSections
            .split(",")
            .map((section) => section.trim())
            .filter(Boolean),
          sourceFile,
        },
        authUser,
      );

      setCreatedDrafts((currentDrafts) => [nextDraft, ...currentDrafts]);
      setPreviewEditionId(nextDraft.id);
      setArticlePageId("");
      setSourceFile(null);
      setUploadStatus("success");
      setUploadMessage("Edition uploaded. Smart processing will create pages and suggested blocks.");
      setWorkspaceRefreshKey((currentKey) => currentKey + 1);
    } catch (error) {
      setUploadStatus("error");
      setUploadMessage(
        error instanceof Error ? error.message : "Unable to create edition draft.",
      );
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSourceFile(event.target.files?.[0] ?? null);
  }

  async function handleAppendPagesChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;

    if (pageAppendInputRef.current) {
      pageAppendInputRef.current.value = "";
    }

    if (!nextFile || !previewEdition || !authUser) {
      setPageAppendStatus("error");
      setUploadMessage("Choose a PDF or image to add pages to this edition.");
      return;
    }

    if (!canManagePublisher(profile, userAccess, previewEdition.publisherId)) {
      setPageAppendStatus("error");
      setUploadMessage("This account cannot add pages for that publisher.");
      return;
    }

    setPageAppendStatus("uploading");
    setUploadMessage("");

    try {
      const updatedEdition = await appendEditionPagesFromFile(
        previewEdition,
        nextFile,
        authUser,
      );
      const addedCount = updatedEdition.pages.length - previewEdition.pages.length;
      const lastPage = updatedEdition.pages[updatedEdition.pages.length - 1];

      setWorkspaceEditions((currentEditions) =>
        upsertEdition(currentEditions, updatedEdition),
      );
      setCreatedDrafts((currentDrafts) =>
        currentDrafts.map((draft) =>
          draft.id === updatedEdition.id ? updatedEdition : draft,
        ),
      );
      setPreviewEditionId(updatedEdition.id);

      if (lastPage) {
        setArticlePageId(lastPage.id);
        resetArticleBlockForm(lastPage.section);
      }

      setPageAppendStatus("success");
      setUploadMessage(
        addedCount === 1
          ? `Page ${lastPage?.pageNumber ?? ""} added. Suggested clips will appear in Page clips shortly.`
          : `${addedCount} pages added. Suggested clips will appear in Page clips shortly.`,
      );
      setWorkspaceRefreshKey((currentKey) => currentKey + 1);
    } catch (error) {
      setPageAppendStatus("error");
      setUploadMessage(
        error instanceof Error ? error.message : "Unable to add pages to this edition.",
      );
    } finally {
      setPageAppendStatus((currentStatus) =>
        currentStatus === "uploading" ? "idle" : currentStatus,
      );
    }
  }

  async function handleDeleteEditionPage(page: Page) {
    if (!authUser || !previewEdition) {
      setUploadStatus("error");
      setUploadMessage("Open an edition before deleting a page.");
      return;
    }

    if (!canManagePublisher(profile, userAccess, previewEdition.publisherId)) {
      setUploadStatus("error");
      setUploadMessage("This account cannot manage that publisher.");
      return;
    }

    if (
      !window.confirm(
        `Delete page ${page.pageNumber}? This removes clips, posts, comments, and engagement for this page.`,
      )
    ) {
      return;
    }

    setPageAppendStatus("uploading");
    setUploadMessage("");

    try {
      const updatedEdition = await deletePublisherEditionPage(previewEdition, page.id);
      const nextPage =
        updatedEdition.pages.find((editionPage) => editionPage.id === articlePageId) ??
        updatedEdition.pages[0] ??
        null;

      setWorkspaceEditions((currentEditions) =>
        upsertEdition(currentEditions, updatedEdition),
      );
      setCreatedDrafts((currentDrafts) =>
        currentDrafts.map((draft) =>
          draft.id === updatedEdition.id ? updatedEdition : draft,
        ),
      );
      setWorkspaceBlocks((currentBlocks) =>
        currentBlocks.filter(
          (block) =>
            block.editionId !== updatedEdition.id || block.pageId !== page.id,
        ),
      );
      setPreviewEditionId(updatedEdition.id);
      setArticlePageId(nextPage?.id ?? "");
      if (nextPage) {
        resetArticleBlockForm(nextPage.section);
      } else {
        resetArticleBlockForm(articleSection);
        setSelectedBlockId("");
      }
      setUploadStatus("success");
      setUploadMessage(`Page ${page.pageNumber} and related content deleted.`);
      setWorkspaceRefreshKey((currentKey) => currentKey + 1);
    } catch (error) {
      setUploadStatus("error");
      setUploadMessage(
        error instanceof Error ? error.message : "Unable to delete this page.",
      );
    } finally {
      setPageAppendStatus("idle");
    }
  }

  function setLocationDraftFromPublisher(
    publisher: Publisher | undefined,
    locations: EditionLocation[],
  ) {
    const publisherLocation = findLocationByCity(publisher?.city, locations);
    const nextLocation = publisherLocation ?? locations[0];

    setDraftState(nextLocation?.state ?? "");
    setDraftCity(publisherLocation ? publisher?.city ?? "" : nextLocation?.cities[0] ?? "");
  }

  async function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser || !canManagePlatform(profile)) {
      setInviteStatus("error");
      setInviteMessage("Only a platform super admin can create agency access invites.");
      return;
    }

    setInviteStatus("saving");
    setInviteMessage("");

    try {
      const nextInvite = await createPublisherStaffInvite(
        {
          email: inviteEmail,
          name: inviteName,
          publisherId: selectedInvitePublisherId,
          role: inviteRole,
        },
        authUser,
      );

      setPendingInvites((currentInvites) => [
        nextInvite,
        ...currentInvites.filter((invite) => invite.id !== nextInvite.id),
      ]);
      setInviteName("");
      setInviteEmail("");
      setInviteStatus("success");
      setInviteMessage(
        "Invite recorded. Run the grant command after the user exists in Firebase Auth.",
      );
    } catch (error) {
      setInviteStatus("error");
      setInviteMessage(
        error instanceof Error ? error.message : "Unable to create access invite.",
      );
    }
  }

  async function handleEditionStatusChange(
    edition: Edition,
    nextStatus: Extract<EditionStatus, "review" | "published" | "archived">,
  ) {
    if (!authUser) {
      setWorkflowStatus("error");
      setWorkflowMessage("Sign in before updating edition status.");
      return;
    }

    if (!canManagePublisher(profile, userAccess, edition.publisherId)) {
      setWorkflowStatus("error");
      setWorkflowMessage("This account cannot manage that publisher.");
      return;
    }

    if (nextStatus === "published" && edition.pages.length === 0) {
      setWorkflowStatus("error");
      setWorkflowMessage("Generate a page preview before publishing this edition.");
      return;
    }

    setWorkflowEditionId(edition.id);
    setWorkflowStatus("success");
    setWorkflowMessage("");

    try {
      const updatedEdition = await updateEditionWorkflowStatus(
        edition,
        nextStatus,
        authUser,
      );

      setWorkspaceEditions((currentEditions) =>
        upsertEdition(currentEditions, updatedEdition),
      );
      setCreatedDrafts((currentDrafts) =>
        currentDrafts
          .map((draft) => (draft.id === updatedEdition.id ? updatedEdition : draft))
          .filter((draft) => draft.status !== "published"),
      );
      setWorkflowStatus("success");
      setWorkflowMessage(
        nextStatus === "published"
          ? "Edition published and visible to eligible readers."
          : "Edition moved back to review.",
      );
    } catch (error) {
      setWorkflowStatus("error");
      setWorkflowMessage(
        error instanceof Error ? error.message : "Unable to update edition status.",
      );
    } finally {
      setWorkflowEditionId("");
    }
  }

  async function handleDeleteEdition(edition: Edition) {
    if (!authUser) {
      setWorkflowStatus("error");
      setWorkflowMessage("Sign in before deleting an edition.");
      return;
    }

    if (!canManagePublisher(profile, userAccess, edition.publisherId)) {
      setWorkflowStatus("error");
      setWorkflowMessage("This account cannot manage that publisher.");
      return;
    }

    if (
      !window.confirm(
        `Delete "${edition.title}"? This removes the edition, uploaded files, clips, and posts.`,
      )
    ) {
      return;
    }

    setWorkflowEditionId(edition.id);
    setWorkflowStatus("success");
    setWorkflowMessage("");

    try {
      await deletePublisherEdition(edition);

      setWorkspaceEditions((currentEditions) =>
        currentEditions.filter((item) => item.id !== edition.id),
      );
      setCreatedDrafts((currentDrafts) =>
        currentDrafts.filter((item) => item.id !== edition.id),
      );
      setWorkspaceBlocks((currentBlocks) =>
        currentBlocks.filter((block) => block.editionId !== edition.id),
      );

      if (previewEditionId === edition.id) {
        setPreviewEditionId("");
        setArticlePageId("");
        resetArticleBlockForm(articleSection);
      }

      setWorkflowStatus("success");
      setWorkflowMessage("Edition deleted.");
      setWorkspaceRefreshKey((currentKey) => currentKey + 1);
    } catch (error) {
      setWorkflowStatus("error");
      setWorkflowMessage(
        error instanceof Error ? error.message : "Unable to delete this edition.",
      );
    } finally {
      setWorkflowEditionId("");
    }
  }

  async function handleGeneratePreviewPages(edition: Edition) {
    if (!authUser) {
      setWorkflowStatus("error");
      setWorkflowMessage("Sign in before generating preview pages.");
      return;
    }

    if (!canManagePublisher(profile, userAccess, edition.publisherId)) {
      setWorkflowStatus("error");
      setWorkflowMessage("This account cannot manage that publisher.");
      return;
    }

    setWorkflowEditionId(edition.id);
    setWorkflowStatus("success");
    setWorkflowMessage("");

    try {
      const updatedEdition = await generateEditionPreviewPages(edition, authUser);

      setWorkspaceEditions((currentEditions) =>
        upsertEdition(currentEditions, updatedEdition),
      );
      setCreatedDrafts((currentDrafts) =>
        currentDrafts.map((draft) =>
          draft.id === updatedEdition.id ? updatedEdition : draft,
        ),
      );
      setPreviewEditionId(updatedEdition.id);
      setArticlePageId(updatedEdition.pages[0]?.id ?? "");
      resetArticleBlockForm(updatedEdition.pages[0]?.section ?? articleSection);
      setWorkflowStatus("success");
      setWorkflowMessage("Preview pages generated for staff review.");
    } catch (error) {
      setWorkflowStatus("error");
      setWorkflowMessage(
        error instanceof Error ? error.message : "Unable to generate preview pages.",
      );
    } finally {
      setWorkflowEditionId("");
    }
  }

  async function handleRequestSmartProcessing(edition: Edition) {
    if (!authUser) {
      setWorkflowStatus("error");
      setWorkflowMessage("Sign in before starting smart processing.");
      return;
    }

    if (!canManagePublisher(profile, userAccess, edition.publisherId)) {
      setWorkflowStatus("error");
      setWorkflowMessage("This account cannot manage that publisher.");
      return;
    }

    setWorkflowEditionId(edition.id);
    setWorkflowStatus("success");
    setWorkflowMessage("");

    try {
      const processingEdition = await requestSmartEditionProcessing(edition, authUser);

      setWorkspaceEditions((currentEditions) =>
        upsertEdition(currentEditions, processingEdition),
      );
      setCreatedDrafts((currentDrafts) =>
        currentDrafts.map((draft) =>
          draft.id === processingEdition.id ? processingEdition : draft,
        ),
      );
      setPreviewEditionId(processingEdition.id);
      setArticlePageId("");
      resetArticleBlockForm();
      setWorkflowStatus("success");
      setWorkflowMessage(
        "Smart processing queued. Use Refresh workspace after a few seconds to load page images and AI blocks.",
      );
    } catch (error) {
      setWorkflowStatus("error");
      setWorkflowMessage(
        error instanceof Error ? error.message : "Unable to queue smart processing.",
      );
    } finally {
      setWorkflowEditionId("");
    }
  }

  function selectPreviewPage(pageId: string) {
    const nextPage = previewEdition?.pages.find((page) => page.id === pageId);

    setArticlePageId(pageId);

    if (nextPage) {
      resetArticleBlockForm(nextPage.section);
    }
  }

  function goToPreviewPageIndex(nextIndex: number) {
    if (!previewEdition || previewEdition.pages.length === 0) {
      return;
    }

    const boundedIndex = Math.max(
      0,
      Math.min(previewEdition.pages.length - 1, nextIndex),
    );

    selectPreviewPage(previewEdition.pages[boundedIndex].id);
  }

  function clearDraftClipPreview() {
    setDraftClipPreviewUrl((currentUrl) => {
      if (currentUrl.startsWith("blob:")) {
        URL.revokeObjectURL(currentUrl);
      }

      return "";
    });
  }

  function applyExtractedClipDetails(
    details: Awaited<ReturnType<typeof extractClipRegionDetails>>,
    pageSection: string,
    clipLabel: string,
  ) {
    setBlockType(details.type);
    setBlockLabel(clipLabel);
    setArticleTitle(details.title);
    setArticleSection(details.section || pageSection);
    setArticleHotspotLabel(details.label);
    setArticleSummary(details.summary);
    setArticleBody(details.body);

    if (details.previewDataUrl) {
      clearDraftClipPreview();
      setDraftClipPreviewUrl(details.previewDataUrl);
    }
  }

  function resetArticleBlockForm(section = "मुख पृष्ठ") {
    setSelectedBlockId("");
    setManualClipActive(false);
    setAwaitingClipDraw(false);
    setClipExtractStatus("idle");
    clearDraftClipPreview();
    setBlockType("article");
    setBlockStatus("draft");
    setBlockLabel("Manual block");
    setArticleTitle("");
    setArticleSection(section);
    setArticleSummary("");
    setArticleBody("");
    setArticleHotspotLabel("Manual block");
    setBlockX(8);
    setBlockY(16);
    setBlockWidth(34);
    setBlockHeight(18);
    setBlockSaveStatus("idle");
    setBlockMessage("");
    setArticleCreateStatus("idle");
    setArticleCreateMessage("");
  }

  function resetCurrentSectionForm() {
    resetArticleBlockForm(selectedArticlePage?.section ?? articleSection);
  }

  function articleBlockDraftDefaults() {
    const fallbackSection =
      articleSection.trim() ||
      selectedBlock?.section.trim() ||
      selectedArticlePage?.section ||
      "General";
    const fallbackTitle =
      articleTitle.trim() ||
      selectedBlock?.title.trim() ||
      selectedBlock?.label.trim() ||
      selectedArticlePage?.headline ||
      `Page ${selectedArticlePage?.pageNumber ?? 1} story`;
    const fallbackLabel =
      blockLabel.trim() ||
      articleHotspotLabel.trim() ||
      selectedBlock?.label.trim() ||
      fallbackTitle;

    return {
      title: fallbackTitle,
      section: fallbackSection,
      label: fallbackLabel,
      hotspotLabel: articleHotspotLabel.trim() || fallbackLabel,
      summary:
        articleSummary.trim() ||
        selectedBlock?.summary.trim() ||
        selectedArticlePage?.subhead ||
        "Publisher-created story block. Review and enrich this summary when ready.",
      body:
        articleBody.trim() ||
        selectedBlock?.body.trim() ||
        "Publisher will add cleaned story text here after OCR review.",
      authorName: articleAuthorName.trim() || "Publisher Desk",
    };
  }

  function handleStartNewClip() {
    if (!selectedArticlePage) {
      return;
    }

    clearDraftClipPreview();
    setClipExtractStatus("idle");
    setSidebarTab("clips");
    setClipDrawMode(true);
    setSectionPanelOpen(true);
    setSelectedBlockId("");
    setManualClipActive(false);
    setAwaitingClipDraw(true);
    setBlockType("article");
    setBlockStatus("draft");
    const nextClipLabel = formatPageClipLabel(selectedPageBlocks);
    setBlockLabel(nextClipLabel);
    setArticleTitle("");
    setArticleSummary("");
    setArticleBody("");
    setArticleHotspotLabel(nextClipLabel);
    setBlockX(0);
    setBlockY(0);
    setBlockWidth(0);
    setBlockHeight(0);
    setBlockSaveStatus("idle");
    setBlockMessage("Drag on the page to draw the clip region.");
    setArticleCreateStatus("idle");
    setArticleCreateMessage("");
  }

  async function handleClipDrawComplete(geometry: ClipRegionGeometry) {
    const normalized = normalizeBlockGeometry(geometry);

    if (!previewEdition || !selectedArticlePage) {
      return;
    }

    setAwaitingClipDraw(false);
    setManualClipActive(true);
    setSectionPanelOpen(true);
    setSidebarTab("clips");
    setSelectedBlockId("");
    setBlockStatus("draft");
    setBlockX(normalized.x);
    setBlockY(normalized.y);
    setBlockWidth(normalized.width);
    setBlockHeight(normalized.height);
    setBlockSaveStatus("idle");
    setArticleCreateStatus("idle");
    setArticleCreateMessage("");
    setClipExtractStatus("loading");
    setBlockMessage("Extracting title, section, and label from the clip...");

    const pageSection = selectedArticlePage.section || articleSection;
    const clipLabel = formatPageClipLabel(selectedPageBlocks);

    try {
      const localPreview = await createDraftClipPreviewUrl(
        previewEdition,
        selectedArticlePage,
        normalized,
      );

      if (localPreview) {
        clearDraftClipPreview();
        setDraftClipPreviewUrl(localPreview);
      }

      const extracted = await extractClipRegionDetails({
        publisherId: previewEdition.publisherId,
        editionId: previewEdition.id,
        pageId: selectedArticlePage.id,
        pageNumber: selectedArticlePage.pageNumber,
        pageSection,
        ...normalized,
      });

      applyExtractedClipDetails(extracted, pageSection, clipLabel);
      setClipExtractStatus("success");
      setBlockMessage("Clip details extracted. Review, save clip, then create post.");
    } catch (error) {
      setClipExtractStatus("error");
      setBlockType("article");
      setBlockLabel(clipLabel);
      setArticleTitle(selectedArticlePage.headline || "New story");
      setArticleSection(pageSection);
      setArticleHotspotLabel(clipLabel);
      setArticleSummary(selectedArticlePage.subhead || "");
      setArticleBody("");
      setBlockMessage(
        error instanceof Error
          ? error.message
          : "Could not extract clip details. Enter them manually.",
      );
    }
  }

  async function handleDeleteBlock(block: ArticleBlock) {
    if (!authUser || !previewEdition) {
      setBlockSaveStatus("error");
      setBlockMessage("Open an edition before deleting a clip.");
      return;
    }

    if (
      !window.confirm(
        block.articlePostId
          ? "Delete this clip from the page? The saved post will stay in the edition."
          : "Delete this clip from the page?",
      )
    ) {
      return;
    }

    setBlockSaveStatus("saving");
    setBlockMessage("");

    try {
      const result = await deleteArticleBlock(block, previewEdition);

      setWorkspaceBlocks((currentBlocks) =>
        currentBlocks.filter((currentBlock) => currentBlock.id !== block.id),
      );

      if (result.edition) {
        setWorkspaceEditions((currentEditions) =>
          upsertEdition(currentEditions, result.edition!),
        );
        setCreatedDrafts((currentDrafts) =>
          currentDrafts.map((draft) =>
            draft.id === result.edition!.id ? result.edition! : draft,
          ),
        );
      }

      if (selectedBlockId === block.id) {
        resetArticleBlockForm(selectedArticlePage?.section ?? articleSection);
      }

      setBlockSaveStatus("success");
      setBlockMessage("Clip deleted.");
    } catch (error) {
      setBlockSaveStatus("error");
      setBlockMessage(error instanceof Error ? error.message : "Unable to delete clip.");
    }
  }

  function handleSelectBlock(block: ArticleBlock) {
    const geometry = normalizeBlockGeometry(block);

    clearDraftClipPreview();
    setClipExtractStatus("idle");
    setSelectedBlockId(block.id);
    setManualClipActive(false);
    setAwaitingClipDraw(false);
    setBlockType(block.type);
    setBlockStatus(block.status === "suggested" ? "accepted" : block.status);
    setBlockLabel(block.label);
    setArticleTitle(block.title);
    setArticleSection(block.section);
    setArticleSummary(block.summary);
    setArticleBody(block.body);
    setArticleHotspotLabel(block.label);
    setBlockX(geometry.x);
    setBlockY(geometry.y);
    setBlockWidth(geometry.width);
    setBlockHeight(geometry.height);
    setArticleCreateStatus("idle");
    setArticleCreateMessage("");
    if (previewEdition) {
      const linkedPost =
        publisherArticles.find((article) => article.id === block.articlePostId) ??
        publisherArticles.find((article) => article.sourceBlockId === block.id);

      if (linkedPost) {
        hydrateSectionFormFromArticle(linkedPost);
      }
    }

    setBlockMessage("");
  }

  async function handleRefreshClipImage() {
    if (!authUser || !previewEdition || !selectedArticlePage || !selectedClipSavedPost || !selectedBlock) {
      setArticleCreateStatus("error");
      setArticleCreateMessage("Save the clip and create a post before updating the clip image.");
      return;
    }

    setArticleCreateStatus("saving");
    setArticleCreateMessage("");

    try {
      const defaults = articleBlockDraftDefaults();
      const geometry = normalizeBlockGeometry({
        x: blockX,
        y: blockY,
        width: blockWidth,
        height: blockHeight,
      });
      const result = await updatePublisherArticlePost(
        {
          articleId: selectedClipSavedPost.id,
          editionId: previewEdition.id,
          pageId: selectedArticlePage.id,
          blockId: selectedBlock.id,
          type: blockType,
          title: defaults.title,
          section: defaults.section,
          summary: defaults.summary,
          body: defaults.body,
          authorName: defaults.authorName,
          accessRule: articleAccessRule,
          discussionRule: articleDiscussionRule,
          hotspotLabel: defaults.hotspotLabel,
          regenerateClipImage: true,
          ...geometry,
        },
        authUser,
      );

      setWorkspaceEditions((currentEditions) =>
        upsertEdition(currentEditions, result.edition),
      );
      setCreatedDrafts((currentDrafts) =>
        currentDrafts.map((draft) =>
          draft.id === result.edition.id ? result.edition : draft,
        ),
      );
      setCreatedArticles((currentArticles) =>
        currentArticles.map((article) =>
          article.id === result.article.id ? result.article : article,
        ),
      );

      if (result.block) {
        setWorkspaceBlocks((currentBlocks) => upsertBlock(currentBlocks, result.block!));
        setSelectedBlockId(result.block.id);
      }

      clearDraftClipPreview();
      if (result.article.clippedImageUrl) {
        setDraftClipPreviewUrl(result.article.clippedImageUrl);
      }

      setArticleCreateStatus("success");
      setArticleCreateMessage("Clip image refreshed from the current rectangle.");
    } catch (error) {
      setArticleCreateStatus("error");
      setArticleCreateMessage(
        error instanceof Error ? error.message : "Unable to refresh the clip image.",
      );
    }
  }

  function updateBlockGeometry(nextGeometry: Partial<BlockGeometry>) {
    const geometry = normalizeBlockGeometry({
      x: blockX,
      y: blockY,
      width: blockWidth,
      height: blockHeight,
      ...nextGeometry,
    });

    setBlockX(geometry.x);
    setBlockY(geometry.y);
    setBlockWidth(geometry.width);
    setBlockHeight(geometry.height);
  }

  async function handleSaveBlockDraft() {
    if (!authUser || !previewEdition || !selectedArticlePage) {
      setBlockSaveStatus("error");
      setBlockMessage("Choose a processed page before saving a block.");
      return;
    }

    setBlockSaveStatus("saving");
    setBlockMessage("");

    try {
      const defaults = articleBlockDraftDefaults();
      const savedClipLabel =
        selectedBlockId && !isGenericClipLabel(defaults.label)
          ? defaults.label
          : formatPageClipLabel(
              selectedPageBlocks.filter((block) => block.id !== selectedBlockId),
            );

      if (savedClipLabel !== blockLabel) {
        setBlockLabel(savedClipLabel);
        if (isGenericClipLabel(articleHotspotLabel)) {
          setArticleHotspotLabel(savedClipLabel);
        }
      }

      const nextBlock = await saveArticleBlockDraft(
        {
          blockId: selectedBlockId || undefined,
          publisherId: previewEdition.publisherId,
          editionId: previewEdition.id,
          pageId: selectedArticlePage.id,
          pageNumber: selectedArticlePage.pageNumber,
          type: blockType,
          status: blockStatus,
          source: selectedBlock?.source ?? "manual",
          label: savedClipLabel,
          title: defaults.title,
          section: defaults.section,
          summary: defaults.summary,
          body: defaults.body,
          x: blockX,
          y: blockY,
          width: blockWidth,
          height: blockHeight,
          confidence: selectedBlock?.confidence,
        },
        authUser,
      );

      setWorkspaceBlocks((currentBlocks) => upsertBlock(currentBlocks, nextBlock));
      setSelectedBlockId(nextBlock.id);
      setManualClipActive(false);
      setBlockSaveStatus("success");
      setBlockMessage(`${savedClipLabel} saved.`);
    } catch (error) {
      setBlockSaveStatus("error");
      setBlockMessage(error instanceof Error ? error.message : "Unable to save block.");
    }
  }

  async function handleBlockDecision(block: ArticleBlock, status: ArticleBlockStatus) {
    setBlockSaveStatus("saving");
    setBlockMessage("");

    try {
      const nextBlock = await updateArticleBlockStatus(block, status);

      setWorkspaceBlocks((currentBlocks) => upsertBlock(currentBlocks, nextBlock));
      setBlockSaveStatus("success");
      setBlockMessage(`Block ${formatRole(status)}.`);
    } catch (error) {
      setBlockSaveStatus("error");
      setBlockMessage(
        error instanceof Error ? error.message : "Unable to update block.",
      );
    }
  }

  async function handleCampaignSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser || !selectedDraftPublisherId) {
      setCampaignStatus("error");
      setCampaignMessage("Sign in and choose a publisher before creating a campaign.");
      return;
    }

    setCampaignStatus("saving");
    setCampaignMessage("");

    try {
      const nextCampaign = await createAdvertiserCampaign(
        {
          publisherId: selectedDraftPublisherId,
          name: campaignName,
          advertiserName: campaignAdvertiser,
          type: "digital_ad",
          target: campaignTarget,
          placementTarget: campaignPlacementTarget,
          placementRef: selectedArticlePage?.id ?? selectedDraftPublisherId,
          budget: campaignBudget,
          status: "active",
        },
        authUser,
      );

      setCreatedCampaigns((currentCampaigns) => [nextCampaign, ...currentCampaigns]);
      setCampaignName("");
      setCampaignAdvertiser("");
      setCampaignTarget("");
      setCampaignStatus("success");
      setCampaignMessage("Advertiser campaign created.");
    } catch (error) {
      setCampaignStatus("error");
      setCampaignMessage(
        error instanceof Error ? error.message : "Unable to create campaign.",
      );
    }
  }

  async function handleStaffStatusChange(
    member: PublisherStaffMembership,
    status: PublisherStaffMembership["status"],
  ) {
    setStaffActionMessage("");

    try {
      const nextMember = await updatePublisherStaffStatus(member, status);

      setStaffDirectory((currentMembers) =>
        currentMembers.map((currentMember) =>
          currentMember.id === nextMember.id ? nextMember : currentMember,
        ),
      );
      setStaffActionMessage(`${formatRole(member.role)} ${formatRole(status)}.`);
    } catch (error) {
      setStaffActionMessage(
        error instanceof Error ? error.message : "Unable to update staff status.",
      );
    }
  }

  async function handleArticleBlockSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser || !previewEdition || !selectedArticlePage) {
      setArticleCreateStatus("error");
      setArticleCreateMessage("Choose a preview edition and page before creating an article.");
      return;
    }

    if (!canManagePublisher(profile, userAccess, previewEdition.publisherId)) {
      setArticleCreateStatus("error");
      setArticleCreateMessage("This account cannot create articles for that publisher.");
      return;
    }

    setArticleCreateStatus("saving");
    setArticleCreateMessage("");

    try {
      const defaults = articleBlockDraftDefaults();
      const geometry = normalizeBlockGeometry({
        x: blockX,
        y: blockY,
        width: blockWidth,
        height: blockHeight,
      });

      if (selectedClipSavedPost && selectedBlock) {
        const updateResult = await updatePublisherArticlePost(
          {
            articleId: selectedClipSavedPost.id,
            editionId: previewEdition.id,
            pageId: selectedArticlePage.id,
            blockId: selectedBlock.id,
            type: blockType,
            title: defaults.title,
            section: defaults.section,
            summary: defaults.summary,
            body: defaults.body,
            authorName: defaults.authorName,
            accessRule: articleAccessRule,
            discussionRule: articleDiscussionRule,
            hotspotLabel: defaults.hotspotLabel,
            regenerateClipImage: true,
            ...geometry,
          },
          authUser,
        );

        setWorkspaceEditions((currentEditions) =>
          upsertEdition(currentEditions, updateResult.edition),
        );
        setCreatedDrafts((currentDrafts) =>
          currentDrafts.map((draft) =>
            draft.id === updateResult.edition.id ? updateResult.edition : draft,
          ),
        );
        setCreatedArticles((currentArticles) =>
          currentArticles.map((article) =>
            article.id === updateResult.article.id ? updateResult.article : article,
          ),
        );

        if (updateResult.block) {
          setWorkspaceBlocks((currentBlocks) =>
            upsertBlock(currentBlocks, updateResult.block!),
          );
        }

        hydrateSectionFormFromArticle(updateResult.article);
        clearDraftClipPreview();

        if (updateResult.article.clippedImageUrl) {
          setDraftClipPreviewUrl(updateResult.article.clippedImageUrl);
        }

        setArticleCreateStatus("success");
        setArticleCreateMessage("Post updated with the latest clip details.");
        return;
      }

      const result = await createArticleBlockFromPreviewPage(
        previewEdition,
        {
          pageId: selectedArticlePage.id,
          blockId: selectedBlock?.id,
          ...geometry,
          title: defaults.title,
          section: defaults.section,
          summary: defaults.summary,
          body: defaults.body,
          authorName: defaults.authorName,
          accessRule: articleAccessRule,
          discussionRule: articleDiscussionRule,
          hotspotLabel: defaults.hotspotLabel,
        },
        authUser,
      );

      setWorkspaceEditions((currentEditions) =>
        upsertEdition(currentEditions, result.edition),
      );
      setCreatedDrafts((currentDrafts) =>
        currentDrafts.map((draft) =>
          draft.id === result.edition.id ? result.edition : draft,
        ),
      );
      setCreatedArticles((currentArticles) => [result.article, ...currentArticles]);

      const nextBlock = selectedBlock
        ? {
            ...selectedBlock,
            articlePostId: result.article.id,
            clippedImageUrl: result.article.clippedImageUrl,
            clippedImagePath: result.article.clippedImagePath,
            status: "published" as const,
            title: result.article.title,
            section: result.article.section,
            summary: result.article.summary,
            body: result.article.body,
          }
        : null;

      if (nextBlock) {
        setWorkspaceBlocks((currentBlocks) => upsertBlock(currentBlocks, nextBlock));
        setSelectedBlockId(nextBlock.id);
      }

      hydrateSectionFormFromArticle(result.article);
      clearDraftClipPreview();

      if (result.article.clippedImageUrl) {
        setDraftClipPreviewUrl(result.article.clippedImageUrl);
      }

      setArticleCreateStatus("success");
      setArticleCreateMessage(
        "Post published. Use Preview as reader or View & edit post below.",
      );
    } catch (error) {
      setArticleCreateStatus("error");
      setArticleCreateMessage(
        error instanceof Error ? error.message : "Unable to create article block.",
      );
    }
  }

  if (!canOpenAdminWorkspace(profile, userAccess)) {
    return (
      <section className="admin-layout">
        <div className="locked-panel">
          <Lock size={24} />
          <div>
            <strong>Publisher authorization required</strong>
            <p>Use a Google account assigned as PaperLoop platform admin or publisher staff.</p>
          </div>
        </div>
      </section>
    );
  }

  if (canManagePlatform(profile)) {
    return (
      <section className="admin-layout">
        <div className="admin-hero">
          <div>
            <span className="eyebrow">Super admin console</span>
            <h1>Manage publisher roles and access for PaperLoop test agencies.</h1>
          </div>
          <a href="#role-assignment" className="admin-action">
            <Users size={18} />
            Assign staff role
          </a>
        </div>

        <div className="metric-grid">
          <article className="metric-card good">
            <span>Publishers</span>
            <strong>{publishers.length}</strong>
            <small>seeded agencies</small>
          </article>
          <article className="metric-card neutral">
            <span>Active staff</span>
            <strong>
              {staffDirectory.filter((member) => member.status === "active").length}
            </strong>
            <small>role records</small>
          </article>
          <article className="metric-card warn">
            <span>Suspended</span>
            <strong>
              {staffDirectory.filter((member) => member.status === "suspended").length}
            </strong>
            <small>restricted users</small>
          </article>
          <article className="metric-card neutral">
            <span>Pending invites</span>
            <strong>{pendingInvites.length}</strong>
            <small>awaiting grant script</small>
          </article>
        </div>

        <div className="admin-grid">
          <section className="workspace-panel" id="role-assignment">
            <div className="section-heading compact">
              <span className="eyebrow">Role assignment</span>
              <h2>Record publisher staff access</h2>
            </div>
            <form className="edition-form" onSubmit={handleInviteSubmit}>
              <div className="form-grid">
                <label>
                  <span>Publisher</span>
                  <select
                    value={selectedInvitePublisherId}
                    onChange={(event) => setInvitePublisherId(event.target.value)}
                  >
                    {publishers.map((publisher) => (
                      <option key={publisher.id} value={publisher.id}>
                        {publisher.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Role</span>
                  <select
                    value={inviteRole}
                    onChange={(event) =>
                      setInviteRole(
                        event.target.value as PublisherStaffMembership["role"],
                      )
                    }
                  >
                    {staffRoles.map((role) => (
                      <option key={role} value={role}>
                        {formatRole(role)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Staff name</span>
                  <input
                    value={inviteName}
                    onChange={(event) => setInviteName(event.target.value)}
                    placeholder="Publisher staff name"
                  />
                </label>
                <label>
                  <span>Staff email</span>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="staff@example.com"
                  />
                </label>
              </div>
              <button disabled={inviteStatus === "saving"}>
                <Users size={18} />
                {inviteStatus === "saving" ? "Saving role..." : "Record role invite"}
              </button>
              {inviteMessage && (
                <p className={`action-feedback ${inviteStatus}`}>{inviteMessage}</p>
              )}
            </form>
          </section>

          <section className="workspace-panel strategy-panel">
            <div className="section-heading compact">
              <span className="eyebrow">Publisher directory</span>
              <h2>Existing test publishers</h2>
            </div>
            <div className="publisher-admin-grid">
              {publishers.map((publisher) => {
                const publisherStaff = staffDirectory.filter(
                  (member) => member.publisherId === publisher.id,
                );

                return (
                  <article className="publisher-admin-card" key={publisher.id}>
                    <div className="publisher-logo">{publisher.logo}</div>
                    <div>
                      <strong>{publisher.name}</strong>
                      <span>
                        {publisher.city}, {publisher.region} • {publisherStaff.length} staff
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="workspace-panel strategy-panel">
            <div className="section-heading compact">
              <span className="eyebrow">Role directory</span>
              <h2>View, suspend, or restore access</h2>
            </div>
            {staffActionMessage && (
              <p className="action-feedback success">{staffActionMessage}</p>
            )}
            <div className="access-directory">
              <div>
                <h3>Active staff</h3>
                {accessStatus === "error" && (
                  <p className="empty-state">Unable to load staff access records.</p>
                )}
                {staffDirectory.length === 0 && accessStatus !== "error" ? (
                  <p className="empty-state">No staff records yet.</p>
                ) : (
                  staffDirectory.map((member) => (
                    <article className="staff-card" key={member.id}>
                      <div>
                        <strong>{formatRole(member.role)}</strong>
                        <span>
                          {publisherName(publishers, member.publisherId)} • {member.userId}
                        </span>
                      </div>
                      <div className="staff-actions">
                        <small>{member.status}</small>
                        {member.status === "active" ? (
                          <button
                            type="button"
                            onClick={() => handleStaffStatusChange(member, "suspended")}
                          >
                            Suspend
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStaffStatusChange(member, "active")}
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>
              <div>
                <h3>Pending invites</h3>
                {pendingInvites.length === 0 ? (
                  <p className="empty-state">No pending agency invites.</p>
                ) : (
                  pendingInvites.map((invite) => (
                    <article className="staff-card invite-card" key={invite.id}>
                      <div>
                        <strong>{invite.name}</strong>
                        <span>
                          {invite.email} • {formatRole(invite.role)} •{" "}
                          {publisherName(publishers, invite.publisherId)}
                        </span>
                        <code>{grantAccessCommand(invite)}</code>
                      </div>
                      <small>{invite.status}</small>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-layout">
      <div className="admin-hero compact">
        <span className="eyebrow">Publisher dashboard</span>
        <h1>Edition studio — upload pages, clip sections, publish posts.</h1>
      </div>

      <div className="metric-grid admin-metric-grid">
        {dashboardStats.map((metric) => (
          <article
            className={`metric-card stat-box stat-box-${publisherMetricVariant(metric.label)}`}
            key={metric.label}
          >
            <div className="stat-box-body">
              <div className="stat-box-copy">
                <strong className="stat-box-value">{metric.value}</strong>
                <span className="stat-box-label">{metric.label}</span>
              </div>
              <div className="stat-box-icon">{publisherMetricIcon(metric.label)}</div>
            </div>
            <div className="stat-box-footer">{metric.delta}</div>
          </article>
        ))}
      </div>

      <div className="admin-grid">
        <section className="workspace-panel edition-studio" id="edition-studio">
          <div className="edition-studio-bar">
            <div className="edition-studio-bar-main">
              {accessiblePublishers.length === 0 ? (
                <p className="empty-state">No publisher workspace is assigned to this account.</p>
              ) : (
                <>
                  <label className="studio-field">
                    <span>Publisher</span>
                    <select
                      value={selectedDraftPublisherId}
                      onChange={(event) => {
                        const nextPublisher = accessiblePublishers.find(
                          (publisher) => publisher.id === event.target.value,
                        );

                        setDraftPublisherId(event.target.value);

                        if (nextPublisher) {
                          setLocationDraftFromPublisher(nextPublisher, editionLocations);
                          setDraftLanguage(nextPublisher.language);
                        }
                      }}
                    >
                      {accessiblePublishers.map((publisher) => (
                        <option key={publisher.id} value={publisher.id}>
                          {publisher.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="studio-field">
                    <span>State</span>
                    <select
                      value={draftState}
                      onChange={(event) => {
                        const nextState = event.target.value;
                        const nextLocation = editionLocations.find(
                          (location) => location.state === nextState,
                        );

                        setDraftState(nextState);
                        setDraftCity(nextLocation?.cities[0] ?? "");
                      }}
                    >
                      {editionLocations.map((location) => (
                        <option key={location.id} value={location.state}>
                          {location.state}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="studio-field">
                    <span>City</span>
                    <select
                      value={selectedDraftCity}
                      onChange={(event) => setDraftCity(event.target.value)}
                    >
                      {draftCityOptions.map((city) => (
                        <option key={city} value={city}>
                          {city}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="studio-field">
                    <span>Language</span>
                    <select
                      value={selectedDraftLanguage}
                      onChange={(event) => setDraftLanguage(event.target.value)}
                    >
                      {editionLanguages.map((languageOption) => (
                        <option key={languageOption.id} value={languageOption.name}>
                          {languageOption.name} ({languageOption.nativeName})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="studio-field">
                    <span>Edition date</span>
                    <input
                      type="date"
                      value={draftDate}
                      onChange={(event) => setDraftDate(event.target.value)}
                    />
                  </label>
                  <label className="studio-field">
                    <span>Edition label</span>
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      placeholder="Optional headline"
                    />
                  </label>
                  <label className="studio-field studio-field-upload">
                    <span>Upload PDF or page image</span>
                    <input
                      type="file"
                      accept="application/pdf,image/png,image/jpeg,image/webp"
                      onChange={handleFileChange}
                    />
                  </label>
                  <button
                    type="button"
                    className="studio-upload-btn"
                    disabled={uploadStatus === "uploading" || !sourceFile}
                    onClick={() => void handleDraftUpload()}
                  >
                    <FileUp size={16} />
                    {uploadStatus === "uploading" ? "Uploading..." : "Upload"}
                  </button>
                  <details className="studio-advanced-fields">
                    <summary>Edition defaults</summary>
                    <div className="studio-advanced-grid">
                      <label className="studio-field">
                        <span>Access</span>
                        <select
                          value={draftAccessRule}
                          onChange={(event) =>
                            setDraftAccessRule(event.target.value as AccessRule)
                          }
                        >
                          <option value="public">Public</option>
                          <option value="subscriber_only">Subscriber only</option>
                          <option value="staff_only">Staff only</option>
                        </select>
                      </label>
                      <label className="studio-field studio-field-wide">
                        <span>Sections</span>
                        <input
                          value={draftSections}
                          onChange={(event) => setDraftSections(event.target.value)}
                          placeholder="मुख पृष्ठ, शहर"
                        />
                      </label>
                    </div>
                  </details>
                </>
              )}
            </div>
            <div className="edition-studio-bar-actions">
              <label className="studio-field">
                <span>Open edition</span>
                <select
                  value={previewEditionId}
                  onChange={(event) => {
                    const edition = reviewQueue.find(
                      (item) => item.id === event.target.value,
                    );

                    setPreviewEditionId(event.target.value);
                    const nextPage =
                      edition?.pages.find((page) => page.imageUrl) ?? edition?.pages[0];
                    setArticlePageId(nextPage?.id ?? "");
                    resetArticleBlockForm(nextPage?.section ?? articleSection);
                  }}
                >
                  <option value="">Select edition...</option>
                  {reviewQueue.map((edition) => (
                    <option key={edition.id} value={edition.id}>
                      {edition.title} • {formatRole(edition.status)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="studio-icon-btn"
                onClick={() => setWorkspaceRefreshKey((currentKey) => currentKey + 1)}
              >
                Refresh
              </button>
              {previewEdition && (
                <>
                  {previewEdition.status === "published" ? (
                    <button
                      type="button"
                      className="studio-icon-btn"
                      disabled={workflowEditionId === previewEdition.id}
                      onClick={() => handleEditionStatusChange(previewEdition, "review")}
                    >
                      Send to review
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="studio-primary-btn"
                      disabled={
                        workflowEditionId === previewEdition.id ||
                        !previewEdition.pages.some((page) => page.imageUrl || page.headline)
                      }
                      onClick={() => handleEditionStatusChange(previewEdition, "published")}
                    >
                      Publish edition
                    </button>
                  )}
                  {Boolean(previewEdition.sourceAssetPath) &&
                    !previewEdition.pages.some((page) => page.imageUrl) && (
                      <button
                        type="button"
                        className="studio-icon-btn"
                        disabled={
                          workflowEditionId === previewEdition.id ||
                          previewEdition.status === "processing"
                        }
                        onClick={() => handleRequestSmartProcessing(previewEdition)}
                      >
                        {previewEdition.status === "processing"
                          ? "Processing..."
                          : "Run processing"}
                      </button>
                    )}
                  <button
                    type="button"
                    className="studio-icon-btn danger-action"
                    disabled={workflowEditionId === previewEdition.id}
                    onClick={() => void handleDeleteEdition(previewEdition)}
                  >
                    <Trash2 size={16} />
                    Delete edition
                  </button>
                </>
              )}
            </div>
          </div>

          {(uploadMessage || workflowMessage) && (
            <div className="edition-studio-feedback">
              {uploadMessage && (
                <p className={`action-feedback ${uploadStatus}`}>{uploadMessage}</p>
              )}
              {workflowMessage && (
                <p className={`action-feedback ${workflowStatus}`}>{workflowMessage}</p>
              )}
            </div>
          )}

          <div className="edition-studio-workflow">
            {currentWorkflowEdition ? (
              <div className="workflow-focus-card compact">
                <div className="workflow-focus-main">
                  <span className="status-chip">{formatRole(currentWorkflowEdition.status)}</span>
                  <strong>{currentWorkflowEdition.title}</strong>
                  <span className="workflow-focus-meta">
                    {currentWorkflowEdition.city} • {currentWorkflowEdition.date} •{" "}
                    {currentWorkflowBlocks.length} blocks • {currentWorkflowPosts.length} posts
                  </span>
                </div>
                <p className="workflow-focus-hint">{currentWorkflowNextAction}</p>
              </div>
            ) : (
              <p className="empty-state">Upload an edition to start clipping sections.</p>
            )}
            <div className="timeline compact-timeline" aria-label="Edition workflow progress">
              {[
                { label: "Upload", done: Boolean(currentWorkflowEdition) },
                { label: "Process", done: currentWorkflowHasPages },
                { label: "Clip sections", done: currentWorkflowBlocks.length > 0 },
                { label: "Create posts", done: currentWorkflowPosts.length > 0 },
                { label: "Publish", done: currentWorkflowEdition?.status === "published" },
              ].map((step, index, steps) => {
                const isCurrent =
                  !step.done && steps.slice(0, index).every((previousStep) => previousStep.done);

                return (
                  <div
                    className={`timeline-step ${step.done ? "done" : ""} ${isCurrent ? "current" : ""}`}
                    key={step.label}
                  >
                    <div className="timeline-step-rail">
                      {index > 0 && (
                        <span
                          className={`timeline-line ${steps[index - 1].done ? "done" : ""}`}
                          aria-hidden="true"
                        />
                      )}
                      <span className="timeline-marker" aria-hidden={step.done}>
                        {step.done ? (
                          <CheckCircle2 size={18} strokeWidth={2.5} />
                        ) : (
                          <span className="timeline-marker-dot" />
                        )}
                      </span>
                      {index < steps.length - 1 && (
                        <span
                          className={`timeline-line ${step.done ? "done" : ""}`}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <span className="timeline-step-label">{step.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {previewEdition && previewEdition.pages.length > 0 ? (
            <div className={`edition-studio-workspace ${sidebarCollapsed ? "rail-collapsed" : ""} ${sectionPanelOpen ? "" : "panel-collapsed"}`}>
              <aside className={`clip-rail ${sidebarCollapsed ? "collapsed" : ""}`}>
                <div className="clip-rail-header">
                  <div className="clip-tabs">
                    <button
                      type="button"
                      className={sidebarTab === "pages" ? "active" : ""}
                      onClick={() => setSidebarTab("pages")}
                    >
                      Pages
                    </button>
                    <button
                      type="button"
                      className={sidebarTab === "clips" ? "active" : ""}
                      onClick={() => setSidebarTab("clips")}
                    >
                      Page clips
                    </button>
                  </div>
                  <button
                    type="button"
                    className="rail-collapse-btn"
                    aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  >
                    {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                  </button>
                </div>

                {!sidebarCollapsed && sidebarTab === "pages" && (
                  <div className="clip-rail-pages">
                    <div className="page-thumb-list">
                      {previewEdition.pages.map((page) => (
                        <div
                          className={`page-thumb-row ${page.id === selectedArticlePage?.id ? "active" : ""}`}
                          key={page.id}
                        >
                          <button
                            type="button"
                            className="page-thumb"
                            onClick={() => selectPreviewPage(page.id)}
                          >
                            {page.thumbnailUrl || page.imageUrl ? (
                              <img
                                src={page.thumbnailUrl ?? page.imageUrl}
                                alt={`Page ${page.pageNumber}`}
                              />
                            ) : (
                              <div className="page-thumb-placeholder">
                                <Newspaper size={22} />
                              </div>
                            )}
                            <span>Page {page.pageNumber}</span>
                            <small>{page.section}</small>
                          </button>
                          <button
                            type="button"
                            className="clip-delete-btn"
                            aria-label={`Delete page ${page.pageNumber}`}
                            disabled={pageAppendStatus === "uploading"}
                            onClick={() => void handleDeleteEditionPage(page)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                      <label
                        className={`page-add-card ${pageAppendStatus === "uploading" ? "loading" : ""}`}
                      >
                        <input
                          ref={pageAppendInputRef}
                          type="file"
                          accept="application/pdf,image/png,image/jpeg,image/webp"
                          disabled={pageAppendStatus === "uploading"}
                          onChange={(event) => void handleAppendPagesChange(event)}
                        />
                        <span className="page-add-card-icon" aria-hidden="true">
                          <Plus size={22} />
                        </span>
                        <strong>
                          {pageAppendStatus === "uploading" ? "Adding page..." : "Add page"}
                        </strong>
                        <span>PDF or image</span>
                      </label>
                    </div>
                  </div>
                )}

                {!sidebarCollapsed && sidebarTab === "clips" && (
                  <div className="clip-rail-body">
                    <div className="clip-list">
                    <button
                      type="button"
                      className={`clip-new-card ${awaitingClipDraw ? "active" : ""}`}
                      onClick={handleStartNewClip}
                    >
                      <Plus size={16} />
                      <strong>New clip</strong>
                      <span>Draw a region on the page</span>
                    </button>
                    {selectedPageBlocks.length === 0 && !awaitingClipDraw && (
                      <p className="empty-state">Add a clip, then drag on the page to set boundaries.</p>
                    )}
                    {selectedPageBlocks.map((block) => (
                      <div
                        className={`clip-list-row ${block.id === selectedBlock?.id ? "active" : ""}`}
                        key={block.id}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectBlock(block)}
                        >
                          <strong>{block.label}</strong>
                          <span>
                            {formatRole(block.type)} • {formatRole(block.status)}
                          </span>
                          {block.clippedImageUrl && <small>Post saved</small>}
                        </button>
                        <button
                          type="button"
                          className="clip-delete-btn"
                          aria-label={`Delete clip ${block.label}`}
                          onClick={() => void handleDeleteBlock(block)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    </div>
                  </div>
                )}
              </aside>

              <div className="edition-studio-stage">
                <div className="clip-toolbar studio-toolbar">
                  <div className="studio-toolbar-group">
                    <button type="button" onClick={() => setHideClips(!hideClips)}>
                      {hideClips ? "Show clips" : "Hide clips"}
                    </button>
                    <button
                      type="button"
                      className={clipDrawMode ? "active" : ""}
                      onClick={() => setClipDrawMode(!clipDrawMode)}
                    >
                      Clip
                    </button>
                  </div>
                  <div className="studio-toolbar-group pagination-controls">
                    <button
                      type="button"
                      aria-label="First page"
                      disabled={selectedPageIndex <= 0}
                      onClick={() => goToPreviewPageIndex(0)}
                    >
                      <ChevronsLeft size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label="Previous page"
                      disabled={selectedPageIndex <= 0}
                      onClick={() => goToPreviewPageIndex(selectedPageIndex - 1)}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <label className="page-jump">
                      <span className="sr-only">Current page</span>
                      <input
                        type="number"
                        min={1}
                        max={totalPreviewPages || 1}
                        value={selectedPageIndex >= 0 ? selectedPageIndex + 1 : 1}
                        onChange={(event) =>
                          goToPreviewPageIndex(Number(event.target.value) - 1)
                        }
                      />
                      <span>of {totalPreviewPages}</span>
                    </label>
                    <button
                      type="button"
                      aria-label="Next page"
                      disabled={selectedPageIndex >= totalPreviewPages - 1}
                      onClick={() => goToPreviewPageIndex(selectedPageIndex + 1)}
                    >
                      <ChevronRight size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label="Last page"
                      disabled={selectedPageIndex >= totalPreviewPages - 1}
                      onClick={() => goToPreviewPageIndex(totalPreviewPages - 1)}
                    >
                      <ChevronsRight size={16} />
                    </button>
                  </div>
                  <div className="studio-toolbar-group zoom-controls">
                    <span>Zoom</span>
                    <button type="button" onClick={() => setClipZoom(Math.max(0.6, clipZoom - 0.1))}>
                      <ZoomOut size={16} />
                    </button>
                    <input
                      type="range"
                      min="60"
                      max="140"
                      step="5"
                      value={Math.round(clipZoom * 100)}
                      onChange={(event) => setClipZoom(Number(event.target.value) / 100)}
                    />
                    <span>{Math.round(clipZoom * 100)}%</span>
                    <button type="button" onClick={() => setClipZoom(1)}>
                      Fit
                    </button>
                  </div>
                  <button
                    type="button"
                    className="section-panel-toggle"
                    onClick={() => setSectionPanelOpen(!sectionPanelOpen)}
                  >
                    {sectionPanelOpen ? "Hide details" : "Show details"}
                  </button>
                </div>

                {selectedArticlePage && (
                  <div className="clip-stage-wrap">
                    <div
                      className="clip-stage-zoom"
                      style={{ transform: `scale(${clipZoom})` }}
                    >
                      <ClipRegionDrawer
                        enabled={clipDrawMode && Boolean(selectedArticlePage.imageUrl)}
                        onDrawComplete={(geometry) => void handleClipDrawComplete(geometry)}
                      >
                        {selectedArticlePage.imageUrl ? (
                          <img
                            src={selectedArticlePage.imageUrl}
                            alt={`Page ${selectedArticlePage.pageNumber}`}
                          />
                        ) : (
                          <div className="clip-placeholder-page">
                            <strong>{selectedArticlePage.headline}</strong>
                            <p>{selectedArticlePage.subhead}</p>
                          </div>
                        )}
                        {!hideClips &&
                          selectedPageBlocks
                            .filter((block) => block.id !== selectedBlockId)
                            .map((block) => (
                              <button
                                type="button"
                                className="clip-block"
                                key={block.id}
                                style={{
                                  left: `${block.x}%`,
                                  top: `${block.y}%`,
                                  width: `${block.width}%`,
                                  height: `${block.height}%`,
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleSelectBlock(block);
                                }}
                              >
                                <span>{block.label}</span>
                              </button>
                            ))}
                        {!hideClips && activeClipOverlay && (
                          <div
                            className={`clip-block active ${activeClipOverlay.isDraft ? "draft" : ""}`}
                            style={{
                              left: `${activeClipOverlay.x}%`,
                              top: `${activeClipOverlay.y}%`,
                              width: `${activeClipOverlay.width}%`,
                              height: `${activeClipOverlay.height}%`,
                            }}
                          >
                            <span>{activeClipOverlay.label}</span>
                          </div>
                        )}
                      </ClipRegionDrawer>
                    </div>
                  </div>
                )}
              </div>

              {sectionPanelOpen && selectedArticlePage && (
                <aside className="section-panel">
                  <div className="section-panel-header">
                    <strong>Section post</strong>
                    <span>Page {selectedArticlePage.pageNumber}</span>
                  </div>
                  <form className="article-block-form compact" onSubmit={handleArticleBlockSubmit}>
                    {(draftClipPreviewUrl ||
                      selectedClipSavedPost?.clippedImageUrl ||
                      selectedBlock?.clippedImageUrl) && (
                      <figure className="saved-clip-preview">
                        <img
                          src={
                            draftClipPreviewUrl ||
                            selectedClipSavedPost?.clippedImageUrl ||
                            selectedBlock?.clippedImageUrl
                          }
                          alt={articleTitle || blockLabel || "Selected clip"}
                        />
                        <figcaption>
                          {clipExtractStatus === "loading"
                            ? "Analyzing clip..."
                            : selectedClipSavedPost
                              ? "Published clip image"
                              : draftClipPreviewUrl
                                ? "Drawn clip preview"
                                : "Saved clipping"}
                        </figcaption>
                      </figure>
                    )}
                    {clipExtractStatus === "loading" && (
                      <p className="clip-extract-status loading">Extracting clip details...</p>
                    )}
                    <div className="form-grid">
                      <label>
                        <span>Type</span>
                        <select
                          value={blockType}
                          disabled={clipExtractStatus === "loading"}
                          onChange={(event) =>
                            setBlockType(event.target.value as ArticleBlockType)
                          }
                        >
                          {blockTypes.map((type) => (
                            <option key={type} value={type}>
                              {formatRole(type)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Section</span>
                        <input
                          value={articleSection}
                          disabled={clipExtractStatus === "loading"}
                          onChange={(event) => setArticleSection(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Title</span>
                        <input
                          value={articleTitle}
                          disabled={clipExtractStatus === "loading"}
                          onChange={(event) => setArticleTitle(event.target.value)}
                          placeholder="Headline"
                        />
                      </label>
                      <label>
                        <span>Hotspot label</span>
                        <input
                          value={blockLabel}
                          disabled={clipExtractStatus === "loading"}
                          onChange={(event) => {
                            setBlockLabel(event.target.value);
                            setArticleHotspotLabel(event.target.value);
                          }}
                        />
                      </label>
                    </div>
                    <details className="section-panel-advanced">
                      <summary>Rectangle &amp; advanced fields</summary>
                      <div className="form-grid geometry-grid">
                        <label>
                          <span>X%</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={blockX}
                            onChange={(event) =>
                              updateBlockGeometry({ x: Number(event.target.value) })
                            }
                          />
                        </label>
                        <label>
                          <span>Y%</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={blockY}
                            onChange={(event) =>
                              updateBlockGeometry({ y: Number(event.target.value) })
                            }
                          />
                        </label>
                        <label>
                          <span>Width%</span>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            step="0.1"
                            value={blockWidth}
                            onChange={(event) =>
                              updateBlockGeometry({ width: Number(event.target.value) })
                            }
                          />
                        </label>
                        <label>
                          <span>Height%</span>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            step="0.1"
                            value={blockHeight}
                            onChange={(event) =>
                              updateBlockGeometry({ height: Number(event.target.value) })
                            }
                          />
                        </label>
                      </div>
                      <label>
                        <span>Summary</span>
                        <textarea
                          value={articleSummary}
                          onChange={(event) => setArticleSummary(event.target.value)}
                          rows={3}
                        />
                      </label>
                      <label>
                        <span>Body</span>
                        <textarea
                          value={articleBody}
                          onChange={(event) => setArticleBody(event.target.value)}
                          rows={4}
                        />
                      </label>
                      <label>
                        <span>Author</span>
                        <input
                          value={articleAuthorName}
                          onChange={(event) => setArticleAuthorName(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Access</span>
                        <select
                          value={articleAccessRule}
                          onChange={(event) =>
                            setArticleAccessRule(event.target.value as AccessRule)
                          }
                        >
                          <option value="public">Public</option>
                          <option value="subscriber_only">Subscriber only</option>
                          <option value="staff_only">Staff only</option>
                        </select>
                      </label>
                      <label>
                        <span>Discussion</span>
                        <select
                          value={articleDiscussionRule}
                          onChange={(event) =>
                            setArticleDiscussionRule(event.target.value as DiscussionRule)
                          }
                        >
                          <option value="logged_in">Logged-in readers</option>
                          <option value="subscriber_only">Subscribers only</option>
                          <option value="disabled">Disabled</option>
                          <option value="locked">Locked</option>
                        </select>
                      </label>
                    </details>
                    <div className="section-panel-actions">
                      {selectedBlock && (
                        <button
                          type="button"
                          className="danger-action"
                          disabled={blockSaveStatus === "saving"}
                          onClick={() => void handleDeleteBlock(selectedBlock)}
                        >
                          Delete clip
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={
                          blockSaveStatus === "saving" ||
                          clipExtractStatus === "loading" ||
                          awaitingClipDraw ||
                          !hasDraftClipGeometry
                        }
                        onClick={handleSaveBlockDraft}
                      >
                        {blockSaveStatus === "saving" ? "Saving..." : "Save clip"}
                      </button>
                      <button
                        type="submit"
                        disabled={
                          articleCreateStatus === "saving" || clipExtractStatus === "loading"
                        }
                      >
                        {articleCreateStatus === "saving"
                          ? selectedClipSavedPost
                            ? "Updating..."
                            : "Publishing..."
                          : selectedClipSavedPost
                            ? "Update post"
                            : "Create post"}
                      </button>
                      {selectedClipSavedPost && (
                        <button
                          type="button"
                          className="secondary-action"
                          disabled={
                            articleCreateStatus === "saving" || clipExtractStatus === "loading"
                          }
                          onClick={() => void handleRefreshClipImage()}
                        >
                          Refresh clip image
                        </button>
                      )}
                      <p className="section-panel-help">
                        <strong>Save clip</strong> stores the rectangle and editor fields on this
                        page. <strong>Create post</strong> publishes the reader story, saves the
                        cropped image, and adds a page hotspot.
                      </p>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={resetCurrentSectionForm}
                      >
                        Reset form
                      </button>
                      {selectedBlock && selectedBlock.status !== "published" && (
                        <button
                          type="button"
                          onClick={() =>
                            handleBlockDecision(
                              selectedBlock,
                              selectedBlock.status === "rejected" ? "accepted" : "rejected",
                            )
                          }
                        >
                          {selectedBlock.status === "rejected" ? "Accept" : "Reject"}
                        </button>
                      )}
                    </div>
                    {blockMessage && (
                      <p className={`action-feedback ${blockSaveStatus}`}>{blockMessage}</p>
                    )}
                    {articleCreateMessage && (
                      <p className={`action-feedback ${articleCreateStatus}`}>
                        {articleCreateMessage}
                      </p>
                    )}
                  </form>
                  {selectedBlock && !awaitingClipDraw && (
                    <div className="created-post-strip compact selected-clip-post">
                      <strong>Published post for this clip</strong>
                      {selectedClipSavedPost ? (
                        <>
                          <article>
                            <span>{selectedClipSavedPost.title}</span>
                            <small>
                              Page {selectedClipSavedPost.pageNumber} •{" "}
                              {formatRole(selectedClipSavedPost.status)}
                            </small>
                          </article>
                          <div className="published-post-links">
                            <a
                              className="text-link-btn"
                              href={`/article/${selectedClipSavedPost.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink size={15} />
                              Preview as reader
                            </a>
                            <Link
                              className="text-link-btn"
                              to={`${EDITION_STUDIO_PATH}/posts/${selectedClipSavedPost.id}`}
                              onClick={() =>
                                writeEditionStudioContext(
                                  publisherPostStudioContext(selectedClipSavedPost),
                                )
                              }
                            >
                              View &amp; edit post
                            </Link>
                          </div>
                          <p className="clip-post-empty">
                            Edit fields above, then use Update post. Change the rectangle or
                            choose Refresh clip image to regenerate the crop.
                          </p>
                        </>
                      ) : (
                        <p className="clip-post-empty">
                          {selectedBlock.clippedImageUrl
                            ? "Clip image is saved. Use Create post to publish this story."
                            : "No post for this clip yet. Save clip, then create post."}
                        </p>
                      )}
                    </div>
                  )}
                </aside>
              )}
            </div>
          ) : (
            <div className="edition-studio-empty">
              {workspaceStatus === "error" ? (
                <p className="empty-state">Unable to load workspace editions.</p>
              ) : reviewQueue.length === 0 ? (
                <p className="empty-state">
                  Choose a date and upload a PDF or page image to begin clipping sections.
                </p>
              ) : previewEdition ? (
                <div className="edition-studio-empty-actions">
                  <p className="empty-state">
                    {previewEdition.status === "processing"
                      ? "Smart processing is running. This view refreshes automatically."
                      : "Run smart processing to generate page images before clipping."}
                  </p>
                  {!previewEdition.pages.some((page) => page.imageUrl) && (
                    <button
                      type="button"
                      className="studio-primary-btn"
                      disabled={
                        workflowEditionId === previewEdition.id ||
                        previewEdition.status === "processing"
                      }
                      onClick={() =>
                        previewEdition.sourceAssetPath
                          ? handleRequestSmartProcessing(previewEdition)
                          : handleGeneratePreviewPages(previewEdition)
                      }
                    >
                      {previewEdition.sourceAssetPath
                        ? "Run smart processing"
                        : "Generate demo preview"}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </section>

        {canManagePlatform(profile) && (
          <section className="workspace-panel">
            <div className="section-heading compact">
              <span className="eyebrow">Super admin access</span>
              <h2>Agency staff invites</h2>
            </div>
            <form className="edition-form" onSubmit={handleInviteSubmit}>
              <div className="form-grid">
                <label>
                  <span>Publisher</span>
                  <select
                    value={selectedInvitePublisherId}
                    onChange={(event) => setInvitePublisherId(event.target.value)}
                  >
                    {accessiblePublishers.map((publisher) => (
                      <option key={publisher.id} value={publisher.id}>
                        {publisher.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Role</span>
                  <select
                    value={inviteRole}
                    onChange={(event) =>
                      setInviteRole(
                        event.target.value as PublisherStaffMembership["role"],
                      )
                    }
                  >
                    {staffRoles.map((role) => (
                      <option key={role} value={role}>
                        {formatRole(role)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Staff name</span>
                  <input
                    value={inviteName}
                    onChange={(event) => setInviteName(event.target.value)}
                    placeholder="Agency admin name"
                  />
                </label>
                <label>
                  <span>Staff email</span>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="staff@example.com"
                  />
                </label>
              </div>
              <button disabled={inviteStatus === "saving"}>
                <Users size={18} />
                {inviteStatus === "saving" ? "Saving invite..." : "Record access invite"}
              </button>
              {inviteMessage && (
                <p className={`action-feedback ${inviteStatus}`}>{inviteMessage}</p>
              )}
            </form>
            <div className="access-directory">
              <div>
                <h3>Active staff</h3>
                {accessStatus === "error" && (
                  <p className="empty-state">Unable to load staff access records.</p>
                )}
                {staffDirectory.length === 0 && accessStatus !== "error" ? (
                  <p className="empty-state">No active staff records yet.</p>
                ) : (
                  staffDirectory.slice(0, 5).map((member) => (
                    <article className="staff-card" key={member.id}>
                      <div>
                        <strong>{formatRole(member.role)}</strong>
                        <span>{publisherName(publishers, member.publisherId)}</span>
                      </div>
                      <small>{member.status}</small>
                    </article>
                  ))
                )}
              </div>
              <div>
                <h3>Pending invites</h3>
                {pendingInvites.length === 0 ? (
                  <p className="empty-state">No pending agency invites.</p>
                ) : (
                  pendingInvites.slice(0, 4).map((invite) => (
                    <article className="staff-card invite-card" key={invite.id}>
                      <div>
                        <strong>{invite.name}</strong>
                        <span>
                          {invite.email} • {formatRole(invite.role)} •{" "}
                          {publisherName(publishers, invite.publisherId)}
                        </span>
                        <code>{grantAccessCommand(invite)}</code>
                      </div>
                      <small>{invite.status}</small>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        <section className="workspace-panel strategy-panel">
          <div className="section-heading compact">
            <span className="eyebrow">Content strategy</span>
            <h2>Optimization signals</h2>
          </div>
          <div className="insight-grid">
            <Insight icon={<TrendingUp size={20} />} title="High reach" text="Civic stories drive 31% more shares than average." />
            <Insight icon={<MessageCircle size={20} />} title="Feedback" text="Parents ask for school-wise safety lists." />
            <Insight icon={<CircleDollarSign size={20} />} title="Revenue" text="Education ads convert best beside subscriber-only stories." />
          </div>
        </section>

        <section className="workspace-panel strategy-panel">
          <div className="section-heading compact">
            <span className="eyebrow">Article performance</span>
            <h2>Blocks, comments, likes, shares, and views</h2>
          </div>
          <div className="article-admin-table">
            {publisherArticles.slice(0, 8).map((article) => (
              <article key={article.id}>
                {article.clippedImageUrl && (
                  <img src={article.clippedImageUrl} alt={article.title} />
                )}
                <div>
                  <strong>{article.title}</strong>
                  <span>
                    {article.section} • Page {article.pageNumber} •{" "}
                    {formatRole(article.status)}
                  </span>
                </div>
                <small>
                  {article.stats.views.toLocaleString()} views •{" "}
                  {(article.stats.likes ?? article.stats.saves).toLocaleString()} likes •{" "}
                  {article.stats.saves.toLocaleString()} saves •{" "}
                  {article.stats.shares.toLocaleString()} shares •{" "}
                  {article.stats.comments} comments
                </small>
                <button
                  type="button"
                  onClick={() => openPublisherPostActivity(article)}
                >
                  Open
                </button>
              </article>
            ))}
            {publisherArticles.length === 0 && (
              <p className="empty-state">Published article blocks will appear here.</p>
            )}
          </div>
          <div className="comment-moderation-list">
            <h3>Latest comments and reports</h3>
            {workspaceComments.slice(0, 5).map((comment) => (
              <article className="comment-card" key={comment.id}>
                <div>
                  <strong>{comment.userName}</strong>
                  <span>{comment.status}</span>
                </div>
                <p>{comment.body}</p>
              </article>
            ))}
            {workspaceComments.length === 0 && (
              <p className="empty-state">No article comments for this publisher yet.</p>
            )}
          </div>
        </section>

        <section className="workspace-panel campaigns-panel" id="targeted-campaigns">
          <div className="section-heading compact">
            <span className="eyebrow">Targeted campaigns</span>
            <h2>Advertiser placements</h2>
          </div>
          <form className="edition-form compact-form" onSubmit={handleCampaignSubmit}>
            <div className="form-grid">
              <label>
                <span>Campaign</span>
                <input
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                  placeholder="Front page sponsor"
                />
              </label>
              <label>
                <span>Advertiser</span>
                <input
                  value={campaignAdvertiser}
                  onChange={(event) => setCampaignAdvertiser(event.target.value)}
                  placeholder="Local advertiser"
                />
              </label>
              <label>
                <span>Placement</span>
                <select
                  value={campaignPlacementTarget}
                  onChange={(event) =>
                    setCampaignPlacementTarget(
                      event.target.value as CampaignInput["placementTarget"],
                    )
                  }
                >
                  <option value="publisher">Publisher</option>
                  <option value="edition">Edition</option>
                  <option value="page">Page</option>
                  <option value="section">Section</option>
                  <option value="article">Article</option>
                </select>
              </label>
              <label>
                <span>Budget</span>
                <input
                  value={campaignBudget}
                  onChange={(event) => setCampaignBudget(event.target.value)}
                />
              </label>
            </div>
            <label>
              <span>Targeting</span>
              <input
                value={campaignTarget}
                onChange={(event) => setCampaignTarget(event.target.value)}
                placeholder="Hindi readers, Delhi NCR, education articles"
              />
            </label>
            <button disabled={campaignStatus === "saving"}>
              <CircleDollarSign size={18} />
              {campaignStatus === "saving" ? "Creating..." : "Create campaign"}
            </button>
            {campaignMessage && (
              <p className={`action-feedback ${campaignStatus}`}>{campaignMessage}</p>
            )}
          </form>
          <div className="campaign-list">
            {activePublisherCampaigns.map((campaign) => (
              <article className="campaign-card" key={campaign.id}>
                <div>
                  <strong>{campaign.name}</strong>
                  <span>
                    {campaign.advertiserName ?? "Advertiser"} • {campaign.target}
                  </span>
                </div>
                <div>
                  <span>{campaign.budget ?? campaign.spend}</span>
                  <strong>{campaign.conversion}</strong>
                </div>
              </article>
            ))}
            {activePublisherCampaigns.length === 0 && (
              <p className="empty-state">No advertiser campaigns for this publisher yet.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
interface StatProps {
  icon: ReactNode;
  label: string;
  value: string;
}

function Stat({ icon, label, value }: StatProps) {
  return (
    <article className="stat-card">
      <div className="stat-card-copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="stat-card-icon" aria-hidden="true">
        {icon}
      </div>
    </article>
  );
}

interface InsightProps {
  icon: ReactNode;
  title: string;
  text: string;
}

function Insight({ icon, title, text }: InsightProps) {
  return (
    <article className="insight-card">
      {icon}
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </article>
  );
}

export default App;

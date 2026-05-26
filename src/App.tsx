import {
  useEffect,
  useMemo,
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
  CircleDollarSign,
  FileUp,
  Filter,
  Flag,
  Fullscreen,
  Globe2,
  LayoutDashboard,
  Lock,
  LogOut,
  MessageCircle,
  Newspaper,
  PlaySquare,
  Search,
  Share2,
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
  isFirebaseConfigured,
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
import { createEditionDraft } from "./services/publisherWorkspaceRepository";
import {
  emptyUserAccess,
  getUserAccess,
  subscribeToUserProfile,
  type UserAccess,
} from "./services/userRepository";
import type {
  ArticlePost,
  AccessRule,
  Campaign,
  Comment,
  Edition,
  MetricCard,
  Publisher,
  UserProfile,
} from "./types";

type View = "dashboard" | "reader" | "article" | "admin";

const languages = ["All", "Hindi"];
const regions = ["All", "Madhya Pradesh", "Delhi NCR", "Maharashtra", "Uttar Pradesh"];
const topics = ["All", "Local", "Politics", "Business", "Education", "Culture"];

function App() {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [selectedPublisherId, setSelectedPublisherId] = useState(
    mockContent.publishers[0].id,
  );
  const [selectedArticleId, setSelectedArticleId] = useState(
    mockContent.articles[0].id,
  );
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("All");
  const [region, setRegion] = useState("All");
  const [topic, setTopic] = useState("All");
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [authUser, setAuthUser] = useState<User | null>(null);
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

  const { publishers, editions, articles, metrics, campaigns } = content;

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
  }, []);

  const selectedPublisher = publishers.find(
    (publisher) => publisher.id === selectedPublisherId,
  ) ?? publishers[0];

  const selectedEdition =
    editions.find((edition) => edition.publisherId === selectedPublisher.id) ??
    editions[0];

  const selectedArticle =
    articles.find((article) => article.id === selectedArticleId) ?? articles[0];

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
        const matchesLanguage = language === "All" || publisher.language === language;
        const matchesRegion = region === "All" || publisher.region === region;
        const matchesTopic = topic === "All" || publisher.topics.includes(topic);

        return matchesSearch && matchesLanguage && matchesRegion && matchesTopic;
      })
      .sort((a, b) => b.popularityScore + b.relevanceScore - (a.popularityScore + a.relevanceScore));
  }, [language, publishers, region, search, topic]);

  function openReader(publisher: Publisher) {
    setSelectedPublisherId(publisher.id);
    setActiveView("reader");
    setPageIndex(0);
  }

  function navigate(view: View) {
    if (view === "admin" && !canOpenAdminWorkspace(profile, userAccess)) {
      setAuthError(
        authUser
          ? "This Google account does not have publisher workspace access yet."
          : "Please sign in with an authorized publisher Google account.",
      );
      return;
    }

    setAuthError("");
    setActiveView(view);
  }

  function openArticle(articleId: string) {
    setSelectedArticleId(articleId);
    setActiveView("article");
  }

  async function handleGoogleLogin() {
    setAuthError("");

    try {
      await signInWithGoogle();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign in.");
    }
  }

  return (
    <div className="app-shell">
      <Header
        activeView={activeView}
        authUser={authUser}
        profile={profile}
        accessStatus={accessStatus}
        canOpenAdmin={canOpenAdminWorkspace(profile, userAccess)}
        onNavigate={navigate}
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
        {activeView === "dashboard" && (
          <Dashboard
            filteredPublishers={filteredPublishers}
            contentSource={content.source}
            contentStatus={contentStatus}
            search={search}
            language={language}
            region={region}
            topic={topic}
            onSearch={setSearch}
            onLanguage={setLanguage}
            onRegion={setRegion}
            onTopic={setTopic}
            onOpenReader={openReader}
          />
        )}

        {activeView === "reader" && (
          <ReaderView
            articles={articles}
            authUser={authUser}
            profile={profile}
            userAccess={userAccess}
            publisher={selectedPublisher}
            edition={selectedEdition}
            pageIndex={pageIndex}
            zoom={zoom}
            onPageIndex={setPageIndex}
            onZoom={setZoom}
            onOpenArticle={openArticle}
          />
        )}

        {activeView === "article" && (
          <ArticleView
            key={selectedArticle.id}
            article={selectedArticle}
            authUser={authUser}
            profile={profile}
            userAccess={userAccess}
            onBack={() => setActiveView("reader")}
            onAuthRequired={() =>
              setAuthError("Please sign in with Gmail to use subscriber actions.")
            }
          />
        )}

        {activeView === "admin" && (
          <AdminView
            campaigns={campaigns}
            editions={editions}
            metrics={metrics}
            profile={profile}
            publishers={publishers}
            authUser={authUser}
            userAccess={userAccess}
          />
        )}
      </main>
    </div>
  );
}

interface HeaderProps {
  activeView: View;
  authUser: User | null;
  profile: UserProfile | null;
  accessStatus: "signed_out" | "loading" | "ready" | "error";
  canOpenAdmin: boolean;
  onNavigate: (view: View) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

function Header({
  activeView,
  authUser,
  profile,
  accessStatus,
  canOpenAdmin,
  onNavigate,
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
          <button className="login-button" onClick={onSignIn}>
            <Globe2 size={18} />
            Gmail login
          </button>
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
  region: string;
  topic: string;
  onSearch: (value: string) => void;
  onLanguage: (value: string) => void;
  onRegion: (value: string) => void;
  onTopic: (value: string) => void;
  onOpenReader: (publisher: Publisher) => void;
}

function Dashboard({
  filteredPublishers,
  contentSource,
  contentStatus,
  search,
  language,
  region,
  topic,
  onSearch,
  onLanguage,
  onRegion,
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
        <Stat icon={<Newspaper size={20} />} label="Publishers" value="42 pilot-ready" />
        <Stat icon={<Users size={20} />} label="Subscribers" value="48K demo cohort" />
        <Stat icon={<Share2 size={20} />} label="Social reach" value="1.2M tracked clicks" />
        <Stat icon={<CircleDollarSign size={20} />} label="Revenue" value="Subscriptions + ads" />
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
            values={languages}
            onChange={onLanguage}
          />
          <SelectFilter
            icon={<Globe2 size={18} />}
            label="Region"
            value={region}
            values={regions}
            onChange={onRegion}
          />
          <SelectFilter
            icon={<Sparkles size={18} />}
            label="Topic"
            value={topic}
            values={topics}
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
}

function SelectFilter({ icon, label, value, values, onChange }: SelectFilterProps) {
  return (
    <label className="select-filter">
      {icon}
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
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
                <small>popularity</small>
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
  pageIndex: number;
  zoom: number;
  onPageIndex: (value: number) => void;
  onZoom: (value: number) => void;
  onOpenArticle: (articleId: string) => void;
}

function ReaderView({
  articles,
  authUser,
  profile,
  userAccess,
  publisher,
  edition,
  pageIndex,
  zoom,
  onPageIndex,
  onZoom,
  onOpenArticle,
}: ReaderViewProps) {
  const page = edition.pages[pageIndex] ?? edition.pages[0];
  const canReadSelectedEdition = canReadEdition(edition, profile, userAccess);
  const pageArticles = articles.filter(
    (article) => article.pageId === page.id && canReadArticle(article, profile, userAccess),
  );

  return (
    <section className="reader-layout">
      <aside className="reader-sidebar">
        <div>
          <span className="eyebrow">Selected paper</span>
          <h2>{publisher.name}</h2>
          <p>
            {publisher.city} edition • {edition.date}
          </p>
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

        <div className="edition-controls">
          <button
            onClick={() => onPageIndex(Math.max(0, pageIndex - 1))}
            disabled={pageIndex === 0}
            aria-label="Previous page"
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            Page {page.pageNumber} of {edition.pages.length}
          </span>
          <button
            onClick={() => onPageIndex(Math.min(edition.pages.length - 1, pageIndex + 1))}
            disabled={pageIndex === edition.pages.length - 1}
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
        </div>

        <div className="section-list">
          {edition.sections.map((section) => (
            <button key={section}>{section}</button>
          ))}
        </div>

        <div className="ad-card">
          <span className="eyebrow">Print to digital ad</span>
          <strong>Local coaching sponsor</strong>
          <p>Targeted to education articles, parents, and Jabalpur subscribers.</p>
        </div>
      </aside>

      <div className="reader-main">
        {!canReadSelectedEdition && (
          <section className="locked-panel" role="status">
            <Lock size={22} />
            <div>
              <strong>Subscriber edition</strong>
              <p>Sign in with an eligible subscription or publisher staff account to read this edition.</p>
            </div>
          </section>
        )}

        <div className="viewer-toolbar">
          <div>
            <span className="eyebrow">Full-page e-paper</span>
            <h1>{page.headline}</h1>
          </div>
          <div className="viewer-actions">
            <button>
              <Bookmark size={18} />
              Save edition
            </button>
            <button>
              <Share2 size={18} />
              Share page
            </button>
          </div>
        </div>

        <div className="paper-stage">
          <div className="paper-page" style={{ transform: `scale(${zoom})` }}>
            <header>
              <span>{publisher.name}</span>
              <small>{edition.date}</small>
            </header>
            <h2>{page.headline}</h2>
            <p>{page.subhead}</p>
            <div className="mock-photo" />
            <div className="paper-body-grid">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="paper-side-ad">Sponsored</div>
            {page.hotspots.map((hotspot) => (
              <button
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
        </div>

        <section className="article-strip">
          <h3>Article posts from this page</h3>
          <div className="article-list">
            {pageArticles.map((article) => (
              <button key={article.id} onClick={() => onOpenArticle(article.id)}>
                <span>{article.section}</span>
                <strong>{article.title}</strong>
                <small>
                  {article.stats.views.toLocaleString()} views • {article.stats.comments} comments
                </small>
              </button>
            ))}
          </div>
        </section>
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
        <div className={`clip-visual ${article.clippedImageTone}`}>
          <span>{article.section}</span>
        </div>
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

interface AdminViewProps {
  authUser: User | null;
  campaigns: Campaign[];
  editions: Edition[];
  metrics: MetricCard[];
  profile: UserProfile | null;
  publishers: Publisher[];
  userAccess: UserAccess;
}

function AdminView({
  authUser,
  campaigns,
  editions,
  metrics,
  profile,
  publishers,
  userAccess,
}: AdminViewProps) {
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
  const [draftTitle, setDraftTitle] = useState("Today edition");
  const [draftDate, setDraftDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [draftCity, setDraftCity] = useState(fallbackPublisher?.city ?? "");
  const [draftLanguage, setDraftLanguage] = useState(
    fallbackPublisher?.language ?? "Hindi",
  );
  const [draftAccessRule, setDraftAccessRule] = useState<AccessRule>("public");
  const [draftSections, setDraftSections] = useState("मुख पृष्ठ, शहर");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [createdDrafts, setCreatedDrafts] = useState<Edition[]>([]);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [uploadMessage, setUploadMessage] = useState("");

  async function handleDraftSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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
          title: draftTitle,
          date: draftDate,
          city: draftCity,
          language: draftLanguage,
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
      setSourceFile(null);
      setUploadStatus("success");
      setUploadMessage("Edition draft uploaded for staff review.");
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

  return (
    <section className="admin-layout">
      <div className="admin-hero">
        <div>
          <span className="eyebrow">Super admin + publisher workspace</span>
          <h1>Manage agencies, editions, subscriptions, ads, and content strategy.</h1>
        </div>
        <a href="#edition-upload" className="admin-action">
          <FileUp size={18} />
          New edition upload
        </a>
      </div>

      <div className="metric-grid">
        {metrics.map((metric) => (
          <article className={`metric-card ${metric.tone}`} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.delta}</small>
          </article>
        ))}
      </div>

      <div className="admin-grid">
        <section className="workspace-panel" id="edition-upload">
          <div className="section-heading compact">
            <span className="eyebrow">Publisher workspace</span>
            <h2>New edition draft</h2>
          </div>
          {accessiblePublishers.length === 0 ? (
            <p className="empty-state">No publisher workspace is assigned to this account.</p>
          ) : (
            <form className="edition-form" onSubmit={handleDraftSubmit}>
              <div className="form-grid">
                <label>
                  <span>Publisher</span>
                  <select
                    value={selectedDraftPublisherId}
                    onChange={(event) => {
                      const nextPublisher = accessiblePublishers.find(
                        (publisher) => publisher.id === event.target.value,
                      );

                      setDraftPublisherId(event.target.value);

                      if (nextPublisher) {
                        setDraftCity(nextPublisher.city);
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
                <label>
                  <span>Title</span>
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    placeholder="Narmada Times - Jabalpur"
                  />
                </label>
                <label>
                  <span>Date</span>
                  <input
                    type="date"
                    value={draftDate}
                    onChange={(event) => setDraftDate(event.target.value)}
                  />
                </label>
                <label>
                  <span>City</span>
                  <input
                    value={draftCity}
                    onChange={(event) => setDraftCity(event.target.value)}
                  />
                </label>
                <label>
                  <span>Language</span>
                  <input
                    value={draftLanguage}
                    onChange={(event) => setDraftLanguage(event.target.value)}
                  />
                </label>
                <label>
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
              </div>
              <label>
                <span>Sections</span>
                <input
                  value={draftSections}
                  onChange={(event) => setDraftSections(event.target.value)}
                  placeholder="मुख पृष्ठ, शहर, बिज़नेस"
                />
              </label>
              <label>
                <span>Source PDF or page image</span>
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                />
              </label>
              <button disabled={uploadStatus === "uploading"}>
                <FileUp size={18} />
                {uploadStatus === "uploading" ? "Uploading..." : "Upload draft"}
              </button>
              {uploadMessage && (
                <p className={`action-feedback ${uploadStatus}`}>{uploadMessage}</p>
              )}
            </form>
          )}
        </section>

        <section className="workspace-panel">
          <div className="section-heading compact">
            <span className="eyebrow">Upload workflow</span>
            <h2>Issue processing</h2>
          </div>
          <div className="timeline">
            {[
              "Edition metadata captured",
              "PDF/page images uploaded",
              "Pages generated for review",
              "Article hotspots clipped",
              "OCR text corrected",
              "Edition ready to publish",
            ].map((step, index) => (
              <div className="timeline-step" key={step}>
                <CheckCircle2 size={18} />
                <span>{step}</span>
                <small>{index < 3 ? "Done" : "Next"}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="workspace-panel">
          <div className="section-heading compact">
            <span className="eyebrow">Targeted campaigns</span>
            <h2>Ads and subscriber growth</h2>
          </div>
          <div className="campaign-list">
            {campaigns.map((campaign) => (
              <article className="campaign-card" key={campaign.id}>
                <div>
                  <strong>{campaign.name}</strong>
                  <span>{campaign.target}</span>
                </div>
                <div>
                  <span>{campaign.spend}</span>
                  <strong>{campaign.conversion}</strong>
                </div>
              </article>
            ))}
          </div>
        </section>

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
            <span className="eyebrow">Edition drafts</span>
            <h2>Recent workspace records</h2>
          </div>
          <div className="draft-list">
            {[...createdDrafts, ...editions.filter((edition) => edition.status !== "published")]
              .slice(0, 6)
              .map((edition) => (
                <article className="draft-card" key={edition.id}>
                  <div>
                    <strong>{edition.title}</strong>
                    <span>
                      {edition.city} • {edition.date} • {edition.status}
                    </span>
                  </div>
                  <small>{edition.sourceAssetName ?? "Metadata only"}</small>
                </article>
              ))}
            {createdDrafts.length === 0 &&
              editions.filter((edition) => edition.status !== "published").length === 0 && (
                <p className="empty-state">No draft editions uploaded yet.</p>
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
    <article>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
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

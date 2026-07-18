import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "./supabase";
import "./App.css";

type ReportStatus = "reviewing" | "safe" | "dangerous";

interface DatabaseReport {
  id: string;
  report_number: number;
  user_id: string;

  category: string;
  platform: string;
  description: string | null;

  // Evidence
  evidence_link: string | null;

  screenshot_path: string | null;
  screenshot_name: string | null;

  file_path: string | null;
  file_name: string | null;
  file_type: string | null;

  created_at: string;

  status: ReportStatus;
  ai_summary: string | null;
  risk_level: number | null;
  reward_claimed: boolean;
}

function formatReportNumber(reportNumber: number): string {
  return `RPT-${String(reportNumber).padStart(6, "0")}`;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

function getEvidenceUrl(path: string) {
  const { data } = supabase.storage
    .from("report-evidence")
    .getPublicUrl(path);

  return data.publicUrl;
}

function normaliseUrl(url: string) {
  if (
    url.startsWith("http://") ||
    url.startsWith("https://")
  ) {
    return url;
  }

  return `https://${url}`;
}

function StatusBadge({ status }: { status: ReportStatus }) {
  if (status === "dangerous") {
    return (
      <span className="status status-dangerous">
        <ShieldAlert size={14} />
        Dangerous
      </span>
    );
  }

  if (status === "safe") {
    return (
      <span className="status status-safe">
        <ShieldCheck size={14} />
        Safe
      </span>
    );
  }

  return (
    <span className="status status-reviewing">
      <Clock3 size={14} />
      Under Review
    </span>
  );
}

export default function App() {
  const [reports, setReports] = useState<DatabaseReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<ReportStatus | "all">("all");
  const [errorMessage, setErrorMessage] = useState("");

  const loadReports = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    const { data, error } = await supabase
      .from("reports")
      .select(`
        id,
        report_number,
        user_id,
        category,
        platform,
        description,

        evidence_link,
        screenshot_path,
        screenshot_name,

        file_path,
        file_name,
        file_type,

        created_at,
        status,
        ai_summary,  
        risk_level,
        reward_claimed
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Unable to load reports:", error);
      setErrorMessage("Unable to load reports.");
      setLoading(false);
      return;
    }

    setReports((data ?? []) as DatabaseReport[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-report-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reports",
        },
        () => {
          void loadReports();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadReports]);

const USER_ID = 1;

async function updateReportStatus(
  report: DatabaseReport,
  newStatus: ReportStatus
) {
  if (report.status === newStatus) return;

  setUpdatingId(report.id);
  setErrorMessage("");

  const shouldAwardPoints =
    newStatus === "dangerous" &&
    !report.reward_claimed;

  try {
    // 1. Update the report status
    const { error: reportError } = await supabase
      .from("reports")
      .update({
        status: newStatus,
        reward_claimed:
          report.reward_claimed || shouldAwardPoints,
      })
      .eq("id", report.id);

    if (reportError) {
      throw reportError;
    }

    // 2. Add 50 points only when first verified dangerous
    if (shouldAwardPoints) {
      const { data: user, error: userReadError } =
        await supabase
          .from("users")
          .select("points, pending_reward_points")
          .eq("id", USER_ID)
          .single();

      if (userReadError) {
        throw userReadError;
      }

      const { error: pointsError } = await supabase
        .from("users")
        .update({
          points: (user.points ?? 0) + 50,
          pending_reward_points:
            (user.pending_reward_points ?? 0) + 50,
      })
      .eq("id", USER_ID);

    if (userReadError) {
        throw userReadError;
      }
    }

    // 3. Refresh the admin dashboard
    await loadReports();
  } catch (error) {
    console.error("Unable to update report:", error);

    setErrorMessage(
      shouldAwardPoints
        ? "Unable to update the report or award points."
        : "Unable to update the report."
    );
  } finally {
    setUpdatingId(null);
  }
}

  const filteredReports = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    return reports.filter((report) => {
      const matchesStatus =
        statusFilter === "all" ||
        report.status === statusFilter;

      const searchableText = [
        formatReportNumber(report.report_number),
        report.category,
        report.platform,
        report.description ?? "",
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        query.length === 0 ||
        searchableText.includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [reports, searchText, statusFilter]);

  const counts = useMemo(
    () => ({
      all: reports.length,
      reviewing: reports.filter(
        (report) => report.status === "reviewing"
      ).length,
      safe: reports.filter(
        (report) => report.status === "safe"
      ).length,
      dangerous: reports.filter(
        (report) => report.status === "dangerous"
      ).length,
    }),
    [reports]
  );

  return (
    <main className="admin-page">
      <div className="admin-container">
        <header className="admin-header">
          <div>
            <p className="eyebrow">CyberSafe JARSS</p>
            <h1>Admin Report Dashboard</h1>
            <p className="subtitle">
              Review community reports and update their
              verification status.
            </p>
          </div>

          <button
            type="button"
            className="refresh-button"
            onClick={() => void loadReports()}
            disabled={loading}
          >
            <RefreshCw
              size={17}
              className={loading ? "spin" : ""}
            />
            Refresh
          </button>
        </header>

        <section className="summary-grid">
          <article className="summary-card">
            <p>All reports</p>
            <strong>{counts.all}</strong>
          </article>

          <article className="summary-card amber">
            <p>Under review</p>
            <strong>{counts.reviewing}</strong>
          </article>

          <article className="summary-card green">
            <p>Verified safe</p>
            <strong>{counts.safe}</strong>
          </article>

          <article className="summary-card red">
            <p>Dangerous</p>
            <strong>{counts.dangerous}</strong>
          </article>
        </section>

        <section className="toolbar">
          <label className="search-box">
            <Search size={18} />
            <input
              value={searchText}
              onChange={(event) =>
                setSearchText(event.target.value)
              }
              placeholder="Search report number, platform or description"
            />
          </label>

          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as
                  | ReportStatus
                  | "all"
              )
            }
          >
            <option value="all">All statuses</option>
            <option value="reviewing">Under review</option>
            <option value="safe">Verified safe</option>
            <option value="dangerous">
              Verified dangerous
            </option>
          </select>
        </section>

        {errorMessage && (
          <div className="error-message">
            <AlertCircle size={17} />
            {errorMessage}
          </div>
        )}

        {loading ? (
          <div className="empty-state">
            <RefreshCw className="spin" />
            <p>Loading reports...</p>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="empty-state">
            <Search />
            <p>No matching reports found.</p>
          </div>
        ) : (
          <section className="report-list">
            {filteredReports.map((report) => {
              const updating = updatingId === report.id;

              return (
                <article
                  key={report.id}
                  className="report-card"
                >
                  <div className="report-content">
                    <div className="report-heading">
                      <div>
                        <h2>
                          {formatReportNumber(
                            report.report_number
                          )}
                        </h2>

                        <p className="metadata">
                          {formatDate(report.created_at)}
                          {" · "}
                          {report.platform}
                        </p>
                      </div>

                      <StatusBadge status={report.status} />
                    </div>

                    <div className="category">
                      {report.category}
                    </div>

                    <p className="description">
                      {report.description ||
                        "No description provided."}
                    </p>

                    <div className="report-info-grid">
                      <div>
                        <span>Risk level</span>
                        <strong>
                          {report.risk_level ?? 0}%
                        </strong>
                      </div>

                      <div>
                        <span>Reward</span>
                        <strong>
                          {report.reward_claimed
                            ? "Awarded"
                            : "Not awarded"}
                        </strong>
                      </div>
                    </div>

                    {report.ai_summary && (
                      <div className="ai-summary">
                        <strong>AI summary</strong>
                        <p>{report.ai_summary}</p>
                      </div>
                    )}
                  </div>
                  
                  <div className="ai-summary">
                    <strong>Submitted Evidence</strong>

                    {!report.evidence_link &&
                    !report.screenshot_path &&
                    !report.file_path ? (
                      <p>No evidence submitted.</p>
                    ) : (
                      <div style={{ marginTop: 10 }}>

                        {/* Link */}
                        {report.evidence_link && (
                          <p>
                            🔗{" "}
                            <a
                              href={normaliseUrl(report.evidence_link)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open Submitted Link
                            </a>
                          </p>
                        )}

                        {/* Screenshot */}
                        {report.screenshot_path && (
                          <div style={{ marginTop: 12 }}>
                            <p><strong>Screenshot</strong></p>

                            <a
                              href={getEvidenceUrl(report.screenshot_path)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <img
                                src={getEvidenceUrl(report.screenshot_path)}
                                alt="Screenshot"
                                style={{
                                  width: "100%",
                                  maxWidth: 350,
                                  borderRadius: 10,
                                  border: "1px solid #ddd",
                                  marginTop: 8,
                                }}
                              />
                            </a>
                          </div>
                        )}

                        {/* Supporting File */}
                        {report.file_path && (
                          <p style={{ marginTop: 12 }}>
                            📄{" "}
                            <a
                              href={getEvidenceUrl(report.file_path)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {report.file_name ?? "Open Supporting File"}
                            </a>
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <aside className="status-controls">
                    <p>Set verification status</p>

                    <button
                      type="button"
                      disabled={updating}
                      onClick={() =>
                        void updateReportStatus(
                          report,
                          "reviewing"
                        )
                      }
                      className={
                        report.status === "reviewing"
                          ? "control-button reviewing active"
                          : "control-button reviewing"
                      }
                    >
                      <Clock3 size={16} />
                      Under Review
                    </button>

                    <button
                      type="button"
                      disabled={updating}
                      onClick={() =>
                        void updateReportStatus(
                          report,
                          "safe"
                        )
                      }
                      className={
                        report.status === "safe"
                          ? "control-button safe active"
                          : "control-button safe"
                      }
                    >
                      <CheckCircle2 size={16} />
                      Verify Safe
                    </button>

                    <button
                      type="button"
                      disabled={updating}
                      onClick={() =>
                        void updateReportStatus(
                          report,
                          "dangerous"
                        )
                      }
                      className={
                        report.status === "dangerous"
                          ? "control-button dangerous active"
                          : "control-button dangerous"
                      }
                    >
                      <ShieldAlert size={16} />
                      Verify Dangerous
                    </button>

                    {updating && (
                      <span className="saving">
                        Saving change...
                      </span>
                    )}
                  </aside>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
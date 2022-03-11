/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * RPC spec is available at https://trac.transmissionbt.com/browser/trunk/extras/rpc-spec.txt
 */

import { List, showToast, Toast, Icon, ActionPanel, Action, Color, getPreferenceValues } from "@raycast/api";
import { useState, useMemo, useCallback, useEffect } from "react";
import Transmission from "transmission-promise";
import { $enum } from "ts-enum-util";
import { formatDistanceToNow } from "date-fns";
import prettyBytes from "pretty-bytes";
import { useInterval, useStateFromLocalStorage } from "./utils/hooks";
import { capitalize, truncate } from "./utils/string";
import { padList } from "./utils/list";
import { createClient } from "./modules/client";
import { renderPieces } from "./utils/renderCells";
import { writeFileSync } from "fs";
import dedent from "dedent-js";

enum TorrentStatus {
  Stopped = 0,
  QueuedToCheckFiles = 1,
  CheckingFiles = 2,
  QueuedToDownload = 3,
  Downloading = 4,
  QueuedToSeed = 5,
  Seeding = 6,
}

const TorrentStatusLabel: Record<string, string> = {
  Stopped: "Stopped",
  QueuedToCheckFiles: "Queued to check files",
  CheckingFiles: "Checking files",
  QueuedToDownload: "Queued to download",
  Downloading: "Downloading",
  QueuedToSeed: "Queued to seed",
  Seeding: "Seeding",
};

const formatDate = (date: number) =>
  new Date(date * 1000).toLocaleString([], {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
  });

type Torrent = {
  id: number;
  torrentFile: string;
  name: string;
  comment: string;
  eta: number;
  percentDone: number;
  metadataPercentComplete: number;
  status: TorrentStatus;
  rateDownload: number;
  rateUpload: number;
  files: { name: string; bytesCompleted: number; length: number }[];
  pieces: string;
  pieceCount: number;
  pieceSize: number;
  hashString: string;
  creator: string;
  dateCreated: number;
  downloadDir: string;
  isPrivate: boolean;
  trackers: { announce: string; scrape: string; id: number; tier: number }[];
  trackerStats: {
    tier: number;
    host: string;
    announce: string;
    leecherCount: number;
    seederCount: number;
    lastScrapeTime: number;
    lastAnnounceTime: number;
    downloadCount: number;
  }[];
};

type SessionStats = {
  activeTorrentCount: number;
  downloadSpeed: number;
  uploadSpeed: number;
  pausedTorrentCount: number;
  torrentCount: number;
};

const preferences = getPreferenceValues();

const NL = "  \n";

const printTorrentDetails = (torrent: Torrent, downloadStats: string) => {
  const img = renderPieces(torrent.pieces, torrent.pieceCount);

  writeFileSync("/tmp/svg", img);

  return dedent(`
    ## Torrent Information

    **Pieces**: ${torrent.pieceCount}, ${prettyBytes(torrent.pieceSize)}
    **Hash**: ${torrent.hashString}  
    **Private**: ${torrent.isPrivate ? "Yes" : "No"}
    **Creator**: ${torrent.creator}
    **Created On**: ${formatDate(torrent.dateCreated)}
    **Download dir**: ${torrent.downloadDir}
    **Comment**:
    ${torrent.comment}

    ## Transfer

    ${downloadStats}

    <img src="data:image/svg+xml;base64,${Buffer.from(img).toString("base64")}" />

    ## Files

    ${torrent.files
      .map(
        (file) =>
          `- ${file.name} (_${((100 / file.length) * file.bytesCompleted).toFixed(2)}% - ${prettyBytes(file.length)}_)`
      )
      .join("\n")}

    ## Trackers

    ${torrent.trackers
      .reduce<Array<Torrent["trackerStats"]>>((acc, tracker) => {
        acc[tracker.tier] = (acc[tracker.tier] || []).concat(
          torrent.trackerStats.find(({ announce }) => announce === tracker.announce) as Torrent["trackerStats"][0]
        );
        return acc;
      }, [])
      .map((trackers) => {
        return [
          `### Tier ${trackers[0].tier + 1}`,

          ...trackers.map((tracker) =>
            dedent(`
                - **${tracker.host}**
                  Last Announce: ${formatDate(tracker.lastAnnounceTime)}
                  Last Scape: ${formatDate(tracker.lastScrapeTime)}
                  Seeders: ${tracker.seederCount}
                  Leechers: ${tracker.leecherCount}
                  Downloaded: ${tracker.downloadCount}
              `)
          ),
        ].join("\n");
      })
      .join("\n")}
  `)
    .split("\n")
    .join(NL);
};

const statusToLabel = (status: TorrentStatus, percentDone: number) => {
  switch (status) {
    case TorrentStatus.Stopped:
      return percentDone === 1 ? "Completed" : "Stopped";
    case TorrentStatus.QueuedToCheckFiles:
      return "Queued to check files";
    case TorrentStatus.CheckingFiles:
      return "Checking files";
    case TorrentStatus.QueuedToDownload:
      return "Queued to download";
    case TorrentStatus.Downloading:
      return "Downloading";
    case TorrentStatus.QueuedToSeed:
      return "Queued to seed";
    case TorrentStatus.Seeding:
      return "Seeding";
  }
};

const statusIconSource = (torrent: Torrent): string => {
  switch (torrent.status) {
    case TorrentStatus.Stopped:
      return torrent.percentDone === 1 ? Icon.Checkmark : "status-stopped.png";
    case TorrentStatus.QueuedToCheckFiles:
    case TorrentStatus.CheckingFiles:
    case TorrentStatus.QueuedToDownload:
      return Icon.Dot;
    case TorrentStatus.Downloading: {
      if (torrent.metadataPercentComplete < 1) return "status-loading.png";
      switch (Math.round(torrent.percentDone * 10)) {
        case 0:
          return "status-progress-0.png";
        case 1:
          return "status-progress-1.png";
        case 2:
          return "status-progress-2.png";
        case 3:
          return "status-progress-3.png";
        case 4:
          return "status-progress-4.png";
        case 5:
          return "status-progress-5.png";
        case 6:
          return "status-progress-6.png";
        case 7:
          return "status-progress-7.png";
        case 8:
          return "status-progress-8.png";
        case 9:
          return "status-progress-9.png";
        case 10:
        default:
          return "status-progress-10.png";
      }
    }
    case TorrentStatus.QueuedToSeed:
    case TorrentStatus.Seeding:
      return Icon.ChevronUp;
    default:
      return Icon.XmarkCircle;
  }
};

const formatEta = (eta: number): string => {
  switch (eta) {
    case -1:
      return "Unavailable";
    case -2:
      return "Unknown";
    default:
      return `${capitalize(formatDistanceToNow(new Date(Date.now() + eta * 1000)))} Left`;
  }
};

const formatStatus = (torrent: Torrent): string => {
  return torrent.status === TorrentStatus.Downloading
    ? formatEta(torrent.eta)
    : statusToLabel(torrent.status, torrent.percentDone);
};

const statusIconColor = (torrent: Torrent): string => {
  switch (torrent.status) {
    case TorrentStatus.Downloading:
      return torrent.metadataPercentComplete < 1 ? Color.Red : Color.Green;
    default:
      return Color.SecondaryText;
  }
};

const sortTorrents = (t1: Torrent, t2: Torrent): number => {
  const direction = preferences.sortDirection === "asc" ? 1 : -1;
  switch (preferences.sortBy) {
    case "progress":
      return (t1.percentDone - t2.percentDone) * direction;
    case "name":
      return t1.name.localeCompare(t2.name) * direction;
    case "status":
      return (t2.status - t1.status) * direction;
    default:
      return 0;
  }
};

const stopAllTorrents = async (transmission: Transmission) => {
  try {
    const { torrents } = (await transmission.get(false)) as { torrents: Torrent[] };
    await transmission.stop(torrents.map((t) => t.id));
  } catch (error: any) {
    console.error(error);
    showToast(Toast.Style.Failure, `Could not stop torrents: ${error.code}`);
  }
};

const startAllTorrents = async (transmission: Transmission) => {
  try {
    const { torrents } = (await transmission.get(false)) as { torrents: Torrent[] };
    await transmission.start(torrents.map((t) => t.id));
  } catch (error: any) {
    console.error(error);
    showToast(Toast.Style.Failure, `Could not start torrents: ${error.code}`);
  }
};

export default function TorrentList() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter, loadingStatusFilter] = useStateFromLocalStorage<
    keyof typeof TorrentStatus | "All"
  >("statusFilter", "All");
  const transmission = useMemo(() => createClient(), []);
  const [torrents, setTorrents] = useState<Torrent[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const [didLoad, setDidLoad] = useState(false);
  const [isShowingDetail, setIsShowingDetail] = useState(false);

  const updateData = useCallback(async () => {
    try {
      const [data, sessionStats] = await Promise.all([transmission.get(false), transmission.sessionStats()]);
      setTorrents(data.torrents);
      setSessionStats(sessionStats);
    } catch (error: any) {
      console.error(error);
      showToast(Toast.Style.Failure, `Could not load torrents: ${error.code}`);
    }
  }, [transmission]);

  useEffect(() => {
    updateData().finally(() => setDidLoad(true));
  }, []);
  useInterval(() => {
    updateData();
  }, 5000);

  const sortedTorrents = useMemo(() => torrents.sort(sortTorrents), [torrents]);

  const paddedRateDownloads = useMemo(
    () => padList(sortedTorrents.map((t) => `${prettyBytes(t.rateDownload)}/s`)),
    [torrents]
  );
  const paddedRateUploads = useMemo(
    () => padList(sortedTorrents.map((t) => `${prettyBytes(t.rateUpload)}/s`)),
    [torrents]
  );
  const paddedPercentDones = useMemo(
    () => padList(sortedTorrents.map((t) => `${Math.round(t.percentDone * 100)}%`)),
    [torrents]
  );

  return (
    <List
      isShowingDetail={isShowingDetail}
      isLoading={!didLoad || loadingStatusFilter}
      searchBarPlaceholder="Filter torrents by name..."
      onSearchTextChange={setSearch}
      searchBarAccessory={
        <List.Dropdown
          value={statusFilter}
          tooltip="Filter by status"
          onChange={(status) => setStatusFilter(status as keyof typeof TorrentStatus)}
        >
          <List.Dropdown.Item title="All" value="All" />
          {$enum(TorrentStatus).map((value) => {
            const status = TorrentStatus[value];
            return <List.Dropdown.Item key={status} title={TorrentStatusLabel[status]} value={status} />;
          })}
        </List.Dropdown>
      }
    >
      {sortedTorrents
        // status filter
        .filter((x) => (statusFilter === "All" ? true : x.status === TorrentStatus[statusFilter]))
        // fuzzy search
        .filter((x) => x.name.toLowerCase().includes(search.toLowerCase()))
        .map((torrent, index) => (
          <TorrentListItem
            key={torrent.id}
            torrent={torrent}
            rateDownload={paddedRateDownloads[index]}
            rateUpload={paddedRateUploads[index]}
            percentDone={paddedPercentDones[index]}
            sessionStats={sessionStats}
            isShowingDetail={isShowingDetail}
            onToggleDetail={() => setIsShowingDetail((value) => !value)}
            onStop={async (torrent) => {
              try {
                await transmission.stop([torrent.id]);
              } catch (error: any) {
                console.error(error);
                showToast(Toast.Style.Failure, `Could not stop torrent: ${torrent.name}`);
                return;
              }
              await updateData();
              showToast(Toast.Style.Success, `Torrent ${torrent.name} stopped`);
            }}
            onStart={async (torrent) => {
              try {
                await transmission.start([torrent.id]);
              } catch (error: any) {
                console.error(error);
                showToast(Toast.Style.Failure, `Could not start torrent: ${torrent.name}`);
                return;
              }
              await updateData();
              showToast(Toast.Style.Success, `Torrent ${torrent.name} started`);
            }}
            onRemove={async (torrent, deleteLocalData) => {
              try {
                await transmission.remove([torrent.id], deleteLocalData);
              } catch (error: any) {
                console.error(error);
                showToast(Toast.Style.Failure, `Could not start torrent: ${torrent.name}`);
                return;
              }
              await updateData();
              showToast(Toast.Style.Success, `Torrent ${torrent.name} deleted`);
            }}
            onStartAll={async () => {
              await startAllTorrents(transmission);
              await updateData();
              showToast(Toast.Style.Success, `All torrents started`);
            }}
            onStopAll={async () => {
              await stopAllTorrents(transmission);
              await updateData();
              showToast(Toast.Style.Success, `All torrents stopped`);
            }}
          />
        ))}
    </List>
  );
}

function TorrentListItem({
  torrent,
  onStop,
  onStart,
  onRemove,
  onStartAll,
  onStopAll,
  onToggleDetail,
  isShowingDetail,
  rateDownload,
  rateUpload,
  percentDone,
  sessionStats,
}: {
  torrent: Torrent;
  onStop: (torrent: Torrent) => Promise<void>;
  onStart: (torrent: Torrent) => Promise<void>;
  onStartAll: (torrent: Torrent) => Promise<void>;
  onStopAll: (torrent: Torrent) => Promise<void>;
  onRemove: (torrent: Torrent, deleteLocalData: boolean) => Promise<void>;
  onToggleDetail: () => void;
  isShowingDetail: boolean;
  rateDownload: string;
  rateUpload: string;
  percentDone: string;
  sessionStats: SessionStats | null;
}) {
  const totalRateDownload = sessionStats != null ? `${prettyBytes(sessionStats.downloadSpeed)}/s` : "N/A";
  const totalRateUpload = sessionStats != null ? `${prettyBytes(sessionStats.uploadSpeed)}/s` : "N/A";

  const selectedTorrentTitle = [
    `ETA: ${formatStatus(torrent)}`,
    torrent.metadataPercentComplete < 1 ? `${torrent.metadataPercentComplete * 100}% metadata` : null,
  ]
    .filter(Boolean)
    .join(" - ");

  const downloadStats = [`↓ ${rateDownload}`, " - ", `↑ ${rateUpload}`, " - ", percentDone].join(" ");

  return (
    <List.Item
      id={String(torrent.id)}
      key={torrent.id}
      title={truncate(torrent.name, 60)}
      icon={{
        source: statusIconSource(torrent),
        tintColor: statusIconColor(torrent),
      }}
      accessoryTitle={!isShowingDetail ? downloadStats : undefined}
      detail={isShowingDetail && <List.Item.Detail markdown={printTorrentDetails(torrent, downloadStats)} />}
      actions={
        <ActionPanel>
          <Action title={isShowingDetail ? "Hide details" : "Show details"} onAction={onToggleDetail} />
          <ActionPanel.Section title={`Selected Torrent (${selectedTorrentTitle})`}>
            <Action
              title={torrent.status === TorrentStatus.Stopped ? "Start Torrent" : "Stop Torrent"}
              onAction={() => (torrent.status === TorrentStatus.Stopped ? onStart(torrent) : onStop(torrent))}
            />
            <ActionPanel.Submenu title="Remove Torrent">
              <Action title="Preserve Local Data" onAction={() => onRemove(torrent, false)} />
              <Action title="Delete Local Data" onAction={() => onRemove(torrent, true)} />
            </ActionPanel.Submenu>
          </ActionPanel.Section>
          <ActionPanel.Section title={`All Torrents (↓ ${totalRateDownload} - ↑ ${totalRateUpload})`}>
            <Action title="Start All" onAction={() => onStartAll(torrent)} />
            <Action title="Stop All" onAction={() => onStopAll(torrent)} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

// Whether the user has at least one export destination configured — reused by the
// sidebar's STORAGE status chip and by WebhookSection.tsx's "is another exporter
// active" gate (previously computed inline there as `anotherExporterActive`), so the
// two checks can't drift apart.
export function isAnyExportConfigured(settings: {
    obsidianVaultName?: string
    autoPostWebhookAfterMeeting?: boolean
    autoDownloadFileAfterMeeting?: boolean
}): boolean {
    return !!settings.obsidianVaultName || settings.autoPostWebhookAfterMeeting === true || settings.autoDownloadFileAfterMeeting === true
}

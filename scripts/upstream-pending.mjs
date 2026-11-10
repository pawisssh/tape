// Lists upstream transcriptonic commits since the fork point that UPSTREAM.md has no row for.
import { execFileSync } from "node:child_process"
import fs from "node:fs"

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()

try {
    git("fetch", "--quiet", "upstream")
} catch {
    console.error("Could not fetch the `upstream` remote. Add it with: git remote add upstream https://github.com/vivek-nexus/transcriptonic.git")
    process.exit(1)
}

const ledger = fs.readFileSync(new URL("../UPSTREAM.md", import.meta.url), "utf8")
const recorded = [...ledger.matchAll(/^\| `([0-9a-f]{7,40})` \|/gm)].map(match => match[1])

const forkPoint = git("merge-base", "HEAD", "upstream/main")
const commits = git("log", "--no-merges", "--reverse", "--format=%H %h %s", `${forkPoint}..upstream/main`)
    .split("\n")
    .filter(Boolean)
    .map(line => {
        const [full, short, ...subject] = line.split(" ")
        return { full, short, subject: subject.join(" ") }
    })

const pending = commits.filter(commit => !recorded.some(sha => commit.full.startsWith(sha)))
if (!pending.length) {
    console.log(`All ${commits.length} upstream commits since the fork point are in UPSTREAM.md.`)
} else {
    console.log(`${pending.length} upstream commit(s) not yet in UPSTREAM.md:`)
    for (const commit of pending) console.log(`  ${commit.short} ${commit.subject}`)
}

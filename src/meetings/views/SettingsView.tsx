import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import LlmSection from "../LlmSection"

export default function SettingsView() {
    const [version, setVersion] = useState("")

    useEffect(() => {
        setVersion(chrome.runtime.getManifest().version)
    }, [])

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Settings</h1>
                <p className="text-muted-foreground mt-1 text-sm">AI configuration and app information.</p>
            </div>

            <div className="mb-4">
                <LlmSection />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>About</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span>v{version}</span>
                        <span>·</span>
                        <a
                            className="text-primary font-bold underline underline-offset-4"
                            href="https://github.com/vivek-nexus/transcriptonic?tab=readme-ov-file#notice"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Notice
                        </a>
                        <span>·</span>
                        <a
                            className="text-primary font-bold underline underline-offset-4"
                            href="https://github.com/vivek-nexus/transcriptonic#readme"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Get help
                        </a>
                        <span>·</span>
                        <a
                            className="text-primary font-bold underline underline-offset-4"
                            href="https://github.com/vivek-nexus/transcriptonic/issues"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Report a bug
                        </a>
                        <span>·</span>
                        <span>
                            Another project by{" "}
                            <a
                                className="text-primary font-bold underline underline-offset-4"
                                href="https://vivek-nexus.github.io"
                                target="_blank"
                                rel="noreferrer"
                            >
                                Vivek
                            </a>
                        </span>
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}

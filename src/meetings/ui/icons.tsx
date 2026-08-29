import * as React from "react"

// Google Material Symbols (Outlined, weight 400) — the exact icon set the Figma
// redesign itself uses (its layer names are literally Material Symbols export names,
// e.g. "download_24dp_1F1F1F_FILL1_wght400_GRAD0_opsz20"). Path data below is copied
// verbatim from the @material-symbols/svg-400 package (Google's own published vector
// data for these exact icon names/fill variants) rather than a font-icon approach, so
// each glyph tints via `currentColor`/Tailwind text-color classes like any other inline
// SVG in this codebase — bundling the ~4MB full variable icon font just for a dozen
// glyphs isn't worth it. Scoped to the Meetings-page redesign only; other pages keep
// lucide-react until their own redesign pass.

type IconProps = React.SVGProps<SVGSVGElement>

function makeIcon(path: string, displayName: string) {
    const Icon = React.forwardRef<SVGSVGElement, IconProps>(({ className, ...props }, ref) => (
        <svg
            ref={ref}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 -960 960 960"
            fill="currentColor"
            className={className ?? "size-6"}
            aria-hidden="true"
            {...props}
        >
            <path d={path} />
        </svg>
    ))
    Icon.displayName = displayName
    return Icon
}

export const UploadIcon = makeIcon(
    "M450-313v-371L330-564l-43-43 193-193 193 193-43 43-120-120v371h-60ZM220-160q-24 0-42-18t-18-42v-143h60v143h520v-143h60v143q0 24-18 42t-42 18H220Z",
    "UploadIcon",
)

export const DownloadIcon = makeIcon(
    "M480-313 287-506l43-43 120 120v-371h60v371l120-120 43 43-193 193ZM220-160q-24 0-42-18t-18-42v-143h60v143h520v-143h60v143q0 24-18 42t-42 18H220Z",
    "DownloadIcon",
)

export const ContentCopyIcon = makeIcon(
    "M300-200q-24 0-42-18t-18-42v-560q0-24 18-42t42-18h440q24 0 42 18t18 42v560q0 24-18 42t-42 18H300Zm0-60h440v-560H300v560ZM180-80q-24 0-42-18t-18-42v-620h60v620h500v60H180Zm120-180v-560 560Z",
    "ContentCopyIcon",
)

export const MoreHorizIcon = makeIcon(
    "M207.86-432Q188-432 174-446.14t-14-34Q160-500 174.14-514t34-14Q228-528 242-513.86t14 34Q256-460 241.86-446t-34 14Zm272 0Q460-432 446-446.14t-14-34Q432-500 446.14-514t34-14Q500-528 514-513.86t14 34Q528-460 513.86-446t-34 14Zm272 0Q732-432 718-446.14t-14-34Q704-500 718.14-514t34-14Q772-528 786-513.86t14 34Q800-460 785.86-446t-34 14Z",
    "MoreHorizIcon",
)

export const CheckCircleFillIcon = makeIcon(
    "m421-298 283-283-46-45-237 237-120-120-45 45 165 166Zm59 218q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Z",
    "CheckCircleFillIcon",
)

export const CircleIcon = makeIcon(
    "M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Zm0-60q142 0 241-99.5T820-480q0-142-99-241t-241-99q-141 0-240.5 99T140-480q0 141 99.5 240.5T480-140Zm0-340Z",
    "CircleIcon",
)

export const KeyboardArrowDownIcon = makeIcon(
    "M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z",
    "KeyboardArrowDownIcon",
)

export const KeyboardArrowRightIcon = makeIcon(
    "M530-481 332-679l43-43 241 241-241 241-43-43 198-198Z",
    "KeyboardArrowRightIcon",
)

export const PlayArrowFillIcon = makeIcon("M320-203v-560l440 280-440 280Z", "PlayArrowFillIcon")

export const StopFillIcon = makeIcon("M240-240v-480h480v480H240Z", "StopFillIcon")

export const RadioButtonCheckedIcon = makeIcon(
    "M612-348q54-54 54-132t-54-132q-54-54-132-54t-132 54q-54 54-54 132t54 132q54 54 132 54t132-54ZM480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Zm0-60q142 0 241-99.5T820-480q0-142-99-241t-241-99q-141 0-240.5 99T140-480q0 141 99.5 240.5T480-140Z",
    "RadioButtonCheckedIcon",
)

export const WebhookIcon = makeIcon(
    "M270-120q-78 0-134-56T80-310q0-67 39-117t101-66v63q-35 14-57.5 46.5T140-310q0 54 38 92t92 38q54 0 92-38t38-92v-30h249q8-9 19-14.5t22-5.5q21 0 35.5 14.5T740-310q0 20-14.5 35T690-260q-11 0-22-5.5T649-280H458q-14 69-66.5 114.5T270-120Zm420 0q-48 0-88.5-22T535-200h86q15 10 32.5 15t36.5 5q54 0 92-38t38-92q0-54-38-92t-92-38q-19 0-35 4.5T624-422L495-640q-20-4-32.5-17.5T450-690q0-21 15-35.5t35-14.5q21 0 35.5 14.5T550-690q0 4-.5 7.5T547-672l103 176q11-2 21.5-3t18.5-1q79 0 134.5 55.5T880-310q0 78-55.5 134T690-120ZM270-260q-20 0-35-15t-15-35q0-18 12.5-31.5T264-360l111-187q-30-29-47.5-65.5T310-690q0-79 56-134.5T500-880q76 0 131 52.5T690-700h-60q-3-51-40.5-85.5T500-820q-54 0-92 38t-38 92q0 42 24.5 75.5T457-567L316-329q2 6 3 10.5t1 8.5q0 20-14.5 35T270-260Z",
    "WebhookIcon",
)

export const DeleteIcon = makeIcon(
    "M261-120q-24.75 0-42.37-17.63Q201-155.25 201-180v-570h-41v-60h188v-30h264v30h188v60h-41v570q0 24-18 42t-42 18H261Zm438-630H261v570h438v-570ZM367-266h60v-399h-60v399Zm166 0h60v-399h-60v399ZM261-750v570-570Z",
    "DeleteIcon",
)

export const SettingsIconMS = makeIcon(
    "m388-80-20-126q-19-7-40-19t-37-25l-118 54-93-164 108-79q-2-9-2.5-20.5T185-480q0-9 .5-20.5T188-521L80-600l93-164 118 54q16-13 37-25t40-18l20-127h184l20 126q19 7 40.5 18.5T669-710l118-54 93 164-108 77q2 10 2.5 21.5t.5 21.5q0 10-.5 21t-2.5 21l108 78-93 164-118-54q-16 13-36.5 25.5T592-206L572-80H388Zm48-60h88l14-112q33-8 62.5-25t53.5-41l106 46 40-72-94-69q4-17 6.5-33.5T715-480q0-17-2-33.5t-7-33.5l94-69-40-72-106 46q-23-26-52-43.5T538-708l-14-112h-88l-14 112q-34 7-63.5 24T306-642l-106-46-40 72 94 69q-4 17-6.5 33.5T245-480q0 17 2.5 33.5T254-413l-94 69 40 72 106-46q24 24 53.5 41t62.5 25l14 112Zm44-210q54 0 92-38t38-92q0-54-38-92t-92-38q-54 0-92 38t-38 92q0 54 38 92t92 38Zm0-130Z",
    "SettingsIconMS",
)

export const CalendarMonthIcon = makeIcon(
    "M180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-60h65v60h340v-60h65v60h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Zm0-490h600v-130H180v130Zm0 0v-130 130Zm300 230q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z",
    "CalendarMonthIcon",
)

export const CableIcon = makeIcon(
    "M190-120q-13 0-21.5-8.5T160-150v-50h-40v-150q0-13 8.5-21.5T150-380h50v-310q0-64 47-107t113-43q63 0 106.5 43.5T510-690v420q0 38 26 64t64 26q41 0 70.5-25.5T700-270v-310h-50q-13 0-21.5-8.5T620-610v-150h40v-50q0-13 8.5-21.5T690-840h80q13 0 21.5 8.5T800-810v50h40v150q0 13-8.5 21.5T810-580h-50v310q0 64-47 107t-113 43q-63 0-106.5-43.5T450-270v-420q0-38-26-64t-64-26q-41 0-70.5 25.5T260-690v310h50q13 0 21.5 8.5T340-350v150h-40v50q0 13-8.5 21.5T270-120h-80Z",
    "CableIcon",
)

export const DescriptionIcon = makeIcon(
    "M319-250h322v-60H319v60Zm0-170h322v-60H319v60ZM220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h361l219 219v521q0 24-18 42t-42 18H220Zm331-554v-186H220v680h520v-494H551ZM220-820v186-186 680-680Z",
    "DescriptionIcon",
)

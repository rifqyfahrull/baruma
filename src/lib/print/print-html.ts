/**
 * Print a self-contained HTML document via the browser's print dialog
 * ("Save as PDF"). Renders into a hidden iframe and calls print(); no
 * dependency. Shared by the brief and RAB PDF exports.
 */
export function printHtmlDocument(html: string): void {
  if (typeof window === "undefined") return

  const iframe = document.createElement("iframe")
  iframe.setAttribute("aria-hidden", "true")
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  })
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) {
    iframe.remove()
    return
  }
  doc.open()
  doc.write(html)
  doc.close()

  const win = iframe.contentWindow
  if (!win) {
    iframe.remove()
    return
  }
  let removed = false
  const cleanup = () => {
    if (removed) return
    removed = true
    setTimeout(() => iframe.remove(), 500)
  }
  win.onafterprint = cleanup
  setTimeout(() => {
    win.focus()
    win.print()
    cleanup()
  }, 300)
}

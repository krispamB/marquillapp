export function formatLinkedinContent(content: string) {
    const specialCharsRegex = /([\\()[\]{}<>@|~_*#])/g;
    return content.replace(specialCharsRegex, "\\$1");
}
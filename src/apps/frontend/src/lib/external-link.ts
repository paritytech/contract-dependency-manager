import { navigateTo } from "@parity/product-sdk-host";

/**
 * Click handler for external anchor tags. Inside the Polkadot Desktop sandbox,
 * routes navigation through the host so the shell opens the URL in
 * a new tab. Outside Desktop, falls through to the anchor's default behavior.
 */
export function handleExternalClick(e: React.MouseEvent<HTMLAnchorElement>) {
    const url = e.currentTarget.href;
    e.preventDefault();
    navigateTo(url)
        .then((result) => {
            if (!result.ok) {
                window.open(url, "_blank", "noopener,noreferrer");
            }
        })
        .catch(() => {
            window.open(url, "_blank", "noopener,noreferrer");
        });
}

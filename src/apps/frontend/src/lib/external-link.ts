import { getTruApi } from "@parity/product-sdk-host";

/**
 * Click handler for external anchor tags. Inside the Polkadot Desktop sandbox,
 * routes navigation through `hostApi.navigateTo` so the shell opens the URL in
 * a new tab. Outside Desktop, falls through to the anchor's default behavior.
 */
export function handleExternalClick(e: React.MouseEvent<HTMLAnchorElement>) {
    const url = e.currentTarget.href;
    e.preventDefault();
    getTruApi()
        .then(async (truApi) => {
            if (truApi) {
                const result = await truApi.navigateTo({ tag: "v1", value: url });
                if (result.isErr()) {
                    window.open(url, "_blank", "noopener,noreferrer");
                }
                return;
            }
            window.open(url, "_blank", "noopener,noreferrer");
        })
        .catch(() => {
            window.open(url, "_blank", "noopener,noreferrer");
        });
}

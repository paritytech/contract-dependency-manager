import { Command } from "commander";
import { runUpdateCheck, UPDATE_CHECK_COMMAND } from "../lib/update-check";

export const updateCheckCommand = new Command(UPDATE_CHECK_COMMAND)
    .description("Refresh the CDM update-check cache (internal)")
    .action(async () => {
        try {
            await runUpdateCheck();
        } catch {
            // Best effort — a failed background check must never surface.
        }
    });

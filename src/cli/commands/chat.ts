import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { formatUserError } from "../../i18n/user-error.js";
import { startHttpServer } from "../../server/index.js";
import { isDaemonHealthy, waitForStopSignal } from "../daemon.js";
import { postChat } from "../http-chat.js";
import { resolveConfig } from "../resolve-config.js";
import { printStatus, runSafely } from "../run-safely.js";

const lang = loadConfig().lang;

/**
 * zh: 用 readline 连 POST /v1/chat。必要时才起 daemon。
 * en: Chat over readline against POST /v1/chat. Start the daemon only if needed.
 */
export const chatCommand = defineCommand({
  meta: {
    name: "chat",
    description: t("cli.chat", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
  },
  async run({ args }) {
    await runSafely(lang, async () => {
      const config = resolveConfig(args.pack);
      let close: (() => Promise<void>) | undefined;
      if (!(await isDaemonHealthy(config.port))) {
        const listening = await startHttpServer(config);
        close = listening.close;
      }
      const url = `http://127.0.0.1:${config.port}/`;
      if (stdin.isTTY !== true) {
        printStatus("cli.chatFallback", lang, url);
        if (close !== undefined) {
          await waitForStopSignal(close);
        }
        return;
      }
      try {
        await readlineChat(url, config.token, config.lang);
      } finally {
        if (close !== undefined) {
          await close();
        }
      }
    });
  },
});

/**
 * zh: 本机 readline 循环，每句只 POST 到 daemon。
 * en: Local readline loop; every turn POSTs to the daemon.
 */
async function readlineChat(
  url: string,
  token: string,
  lang: ReturnType<typeof loadConfig>["lang"],
): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const line = await rl.question(t("cli.prompt", lang));
      const message = line.trim();
      if (message === "") {
        continue;
      }
      stdout.write(`${t("cli.steward", lang)} `);
      try {
        for await (const chunk of postChat(url, token, message)) {
          stdout.write(chunk);
        }
        stdout.write("\n");
      } catch (err) {
        console.error(formatUserError(err, lang));
      }
    }
  } finally {
    rl.close();
  }
}

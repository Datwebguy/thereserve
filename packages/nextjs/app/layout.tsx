import "@scaffold-hbar-ui/components/styles.css";
import { ScaffoldHbarAppWithProviders } from "~~/components/ScaffoldHbarAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "The Reserve",
  description:
    "An HTS token that can't be minted beyond its HBAR reserves, valued by Chainlink and guarded against bad prices.",
});

const ScaffoldHbarApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <html suppressHydrationWarning>
      <body>
        <ThemeProvider enableSystem>
          <ScaffoldHbarAppWithProviders>{children}</ScaffoldHbarAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldHbarApp;

# LinkedIn extension

This unpacked Chrome extension supports **LinkedIn Easy Apply**. It captures the
job temporarily when Easy Apply opens and records it after you click the final
Submit application button. It still watches for LinkedIn's confirmation UI, but
does not depend on fragile confirmation markup. Cancelling the flow does not
create an application.

## Install locally

1. Start the Job Tracker backend and frontend.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select this `extension` directory.
6. Open a LinkedIn job details page and complete an Easy Apply submission.

LinkedIn changes its page markup regularly. The detector uses multiple selectors
and confirmation phrases and always deduplicates imports by LinkedIn job ID in
PostgreSQL. External Apply flows that leave LinkedIn are intentionally not marked
as submitted because LinkedIn cannot confirm their completion.

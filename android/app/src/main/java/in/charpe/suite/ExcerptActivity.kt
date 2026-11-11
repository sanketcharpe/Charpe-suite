package `in`.charpe.suite

/**
 * Excerpt Desk — its own icon on the phone, inside the Charpe Suite app.
 *
 * It is the same app underneath, so Excerpt Desk sees the cases and orders the
 * Case Manager keeps on this phone (⚖ Case, 🤖 Ask), and gets the microphone,
 * the file picker, saving/sharing and printing. It runs as a separate window
 * in the phone's recent apps.
 */
class ExcerptActivity : MainActivity() {
    override val startUrl: String = "https://sanketcharpe.github.io/excerpt-desk/"
}

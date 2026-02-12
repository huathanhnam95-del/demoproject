# LanguageTool Self-Hosting Guide

If the public API becomes slow, hits rate limits, or you need 100% privacy, follow these steps to host your own LanguageTool server.

## Option 1: Docker (Recommended)

This is the fastest and cleanest way to run LanguageTool.

1. **Run the Container**:

    ```bash
    docker run -d -p 8081:8081 --name languagetool sillvva/languagetool
    ```

2. **Test the Server**:

    ```bash
    curl -X POST http://localhost:8081/v2/check -d "text=I has a cat" -d "language=en-US"
    ```

3. **Update App Config**:
    In `public/js/writing-challenge.js`, change the endpoint in `checkWithLanguageTool()`:

    ```javascript
    // FROM:
    const response = await fetch('https://api.languagetool.org/v2/check', ...)
    // TO:
    const response = await fetch('http://your-server-ip:8081/v2/check', ...)
    ```

## Option 2: Manual Installation (Java)

1. **Requirements**: Java 8 or higher.
2. **Download**: Get the latest standalone zip from [languagetool.org](https://languagetool.org/download/LanguageTool-stable.zip).
3. **Run**:

    ```bash
    java -cp languagetool-server.jar org.languagetool.server.HTTPServer --port 8081 --allow-origin "*"
    ```

## Maintenance Notes

- **Memory**: LanguageTool can be RAM-heavy (~1GB+) if many languages are enabled.
- **Rules**: The open-source version does not include Premium rules, but it is much faster than the public API when self-hosted locally.

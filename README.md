# Deployment Guide

## Prerequisites

### Node.js
```bash
# macOS
brew install node

# Or download from https://nodejs.org/
```

### Java & Maven (for Jenkins plugin)
```bash
# macOS
brew install maven
```

### Jenkins (local)
```bash
# macOS
brew install jenkins-lts
brew services start jenkins-lts
```

Jenkins runs at http://localhost:8080

---

## Jenkins Plugin

Build:
```bash
cd test
mvn clean package -DskipTests
```

Install:
```bash
cp target/accessibility-agent.hpi ~/.jenkins/plugins/
```

Restart Jenkins:
```bash
brew services restart jenkins-lts
```

---

## GitHub Action

Build:
```bash
cd test-website/.github/actions/accessibility-agent
npm install
npm run build
```

Then commit and push changes to `test-website` repo.

---

## Dashboard

Install dependencies:
```bash
cd dashboard
npm install
```

Run:
```bash
npm run dev
```

Runs at http://localhost:3000
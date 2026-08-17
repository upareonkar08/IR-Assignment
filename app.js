/* ============================================
   KeyScan — Application Logic
   ============================================ */

(() => {
  'use strict';

  // --- State ---
  const state = {
    files: [],       // { name: string, text: string }[]
    keyword: '',
    debounceTimer: null,
  };

  // --- DOM refs ---
  const $ = (sel) => document.querySelector(sel);
  const dropZone = $('#drop-zone');
  const fileInput = $('#file-input');
  const browseBtn = $('#browse-btn');
  const uploadProgress = $('#upload-progress');
  const progressFilename = $('#progress-filename');
  const progressPercent = $('#progress-percent');
  const progressBar = $('#progress-bar');
  const progressStatus = $('#progress-status');

  const statsSection = $('#stats-section');
  const statTotal = $('#stat-total');
  const statTxt = $('#stat-txt');
  const statDocx = $('#stat-docx');
  const resetBtn = $('#reset-btn');

  const searchSection = $('#search-section');
  const searchInput = $('#search-input');
  const searchOptionsToggle = $('#search-options-toggle');
  const searchOptions = $('#search-options');
  const caseSensitiveCheck = $('#case-sensitive');
  const wholeWordCheck = $('#whole-word');

  const resultsSection = $('#results-section');
  const resultsSummary = $('#results-summary');
  const resultsList = $('#results-list');

  const emptyState = $('#empty-state');
  const emptyKeyword = $('#empty-keyword');

  // --- Upload Handlers ---
  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  // Drag & drop
  ['dragenter', 'dragover'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.endsWith('.zip')) {
      handleFile(files[0]);
    }
  });

  // --- Process ZIP ---
  async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      alert('Please upload a .zip file');
      return;
    }

    // Show progress
    dropZone.classList.add('hidden');
    uploadProgress.classList.remove('hidden');
    progressFilename.textContent = file.name;
    progressPercent.textContent = '0%';
    progressBar.style.width = '0%';
    progressStatus.textContent = 'Reading ZIP archive…';

    state.files = [];

    try {
      const zip = await JSZip.loadAsync(file);
      const entries = Object.entries(zip.files).filter(([name, entry]) => {
        if (entry.dir) return false;
        const lowerName = name.toLowerCase();
        return lowerName.endsWith('.txt') || lowerName.endsWith('.docx') || lowerName.endsWith('.doc');
      });

      const total = entries.length;
      if (total === 0) {
        progressStatus.textContent = 'No .txt or .docx files found in the ZIP.';
        progressBar.style.width = '100%';
        progressPercent.textContent = '100%';
        return;
      }

      let processed = 0;

      for (const [name, entry] of entries) {
        const lowerName = name.toLowerCase();
        let text = '';

        try {
          if (lowerName.endsWith('.txt')) {
            text = await entry.async('string');
          } else if (lowerName.endsWith('.docx')) {
            const arrayBuffer = await entry.async('arraybuffer');
            const result = await mammoth.extractRawText({ arrayBuffer });
            text = result.value;
          } else if (lowerName.endsWith('.doc')) {
            // .doc files can't be parsed client-side easily; attempt raw text
            text = await entry.async('string');
          }
        } catch (err) {
          console.warn(`Could not parse ${name}:`, err);
          text = '';
        }

        state.files.push({ name, text });
        processed++;

        const pct = Math.round((processed / total) * 100);
        progressBar.style.width = pct + '%';
        progressPercent.textContent = pct + '%';
        progressStatus.textContent = `Processing ${processed} of ${total} files…`;

        // Yield to keep UI responsive
        if (processed % 10 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      progressStatus.textContent = `Done! ${total} files loaded.`;

      // Count types
      let txtCount = 0, docxCount = 0;
      state.files.forEach((f) => {
        const n = f.name.toLowerCase();
        if (n.endsWith('.txt')) txtCount++;
        else if (n.endsWith('.docx') || n.endsWith('.doc')) docxCount++;
      });

      statTotal.textContent = total;
      statTxt.textContent = txtCount;
      statDocx.textContent = docxCount;

      // Transition to search UI
      setTimeout(() => {
        uploadProgress.classList.add('hidden');
        dropZone.classList.add('hidden');
        statsSection.classList.remove('hidden');
        searchSection.classList.remove('hidden');
        searchInput.focus();

        // Collapse upload card
        const uploadCard = $('#upload-section');
        uploadCard.classList.add('hidden');
      }, 600);

    } catch (err) {
      console.error(err);
      progressStatus.textContent = 'Error reading ZIP file. Please try again.';
      progressBar.style.width = '0%';
    }
  }

  // --- Reset ---
  resetBtn.addEventListener('click', () => {
    state.files = [];
    state.keyword = '';
    searchInput.value = '';

    const uploadCard = $('#upload-section');
    uploadCard.classList.remove('hidden');
    dropZone.classList.remove('hidden');
    uploadProgress.classList.add('hidden');
    statsSection.classList.add('hidden');
    searchSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    emptyState.classList.add('hidden');

    fileInput.value = '';
  });

  // --- Search ---
  searchInput.addEventListener('input', () => {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      performSearch();
    }, 250);
  });

  // Re-search when options change
  caseSensitiveCheck.addEventListener('change', performSearch);
  wholeWordCheck.addEventListener('change', performSearch);

  // Toggle search options
  searchOptionsToggle.addEventListener('click', () => {
    searchOptions.classList.toggle('hidden');
  });

  function performSearch() {
    const rawKeyword = searchInput.value.trim();
    if (!rawKeyword) {
      resultsSection.classList.add('hidden');
      emptyState.classList.add('hidden');
      return;
    }

    state.keyword = rawKeyword;
    const caseSensitive = caseSensitiveCheck.checked;
    const wholeWord = wholeWordCheck.checked;

    // Count occurrences in each file
    const results = state.files.map((file) => {
      const count = countOccurrences(file.text, rawKeyword, caseSensitive, wholeWord);
      return { name: file.name, count };
    });

    // Filter and sort descending
    const matched = results.filter((r) => r.count > 0);
    matched.sort((a, b) => b.count - a.count);

    if (matched.length === 0) {
      resultsSection.classList.add('hidden');
      emptyState.classList.remove('hidden');
      emptyKeyword.textContent = rawKeyword;
      return;
    }

    emptyState.classList.add('hidden');
    resultsSection.classList.remove('hidden');

    // Summary
    const totalOccurrences = matched.reduce((sum, r) => sum + r.count, 0);
    resultsSummary.innerHTML = `
      Found <strong>${totalOccurrences.toLocaleString()}</strong> occurrence${totalOccurrences !== 1 ? 's' : ''}
      across <strong>${matched.length}</strong> file${matched.length !== 1 ? 's' : ''}
    `;

    // Render results
    const maxCount = matched[0].count;
    resultsList.innerHTML = '';

    matched.forEach((item, idx) => {
      const rank = idx + 1;
      const row = document.createElement('div');
      row.className = 'result-row';
      row.style.animationDelay = `${Math.min(idx * 0.04, 0.8)}s`;

      const basename = item.name.split('/').pop();
      const dirPath = item.name.includes('/') ? item.name.substring(0, item.name.lastIndexOf('/')) : '';
      const barWidth = Math.max((item.count / maxCount) * 100, 2);

      let rankClass = 'rank-default';
      if (rank === 1) rankClass = 'rank-1';
      else if (rank === 2) rankClass = 'rank-2';
      else if (rank === 3) rankClass = 'rank-3';

      row.innerHTML = `
        <div class="result-rank ${rankClass}">${rank}</div>
        <div class="result-info">
          <div class="result-filename" title="${escapeHtml(item.name)}">${escapeHtml(basename)}</div>
          ${dirPath ? `<div class="result-path" title="${escapeHtml(dirPath)}">${escapeHtml(dirPath)}</div>` : ''}
        </div>
        <div class="result-count">
          <span class="count-number">${item.count.toLocaleString()}</span>
          <span class="count-label">match${item.count !== 1 ? 'es' : ''}</span>
        </div>
        <div class="result-bar-wrap">
          <div class="result-bar" style="width: ${barWidth}%"></div>
        </div>
      `;

      resultsList.appendChild(row);
    });
  }

  // --- Helpers ---
  function countOccurrences(text, keyword, caseSensitive, wholeWord) {
    if (!text || !keyword) return 0;

    let searchText = text;
    let searchKeyword = keyword;

    if (!caseSensitive) {
      searchText = text.toLowerCase();
      searchKeyword = keyword.toLowerCase();
    }

    if (wholeWord) {
      // Use regex for whole word matching
      const escaped = searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(`\\b${escaped}\\b`, flags);
      const matches = text.match(regex);
      return matches ? matches.length : 0;
    }

    // Simple substring count
    let count = 0;
    let pos = 0;
    const kLen = searchKeyword.length;

    while (true) {
      pos = searchText.indexOf(searchKeyword, pos);
      if (pos === -1) break;
      count++;
      pos += kLen;
    }

    return count;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();

// ============================================
// SIGNAL NOIR - Google Apps Script
// ============================================
//
// SETUP INSTRUCTIONS:
// 1. Open your Google Sheet: https://docs.google.com/spreadsheets/
// 2. Go to Extensions > Apps Script
// 3. Delete any existing code and paste this entire file
// 4. Click the Save icon (or Ctrl+S)
// 5. Click Deploy > New Deployment
// 6. Click the gear icon next to "Select type" and choose "Web app"
// 7. Set "Execute as" to "Me"
// 8. Set "Who has access" to "Anyone"
// 9. Click Deploy
// 10. Authorize the app when prompted
// 11. Copy the Web App URL and paste it into SignalNoirApp.jsx as APPS_SCRIPT_URL
//
// NOTE: Your sheet should have a tab named "Master_Dashboard" with these columns:
// A: Publication Name
// B: Overall Score
// C: (optional)
// D: Authority
// E: AI Citations
// F: Content
// G: Topical
// H: Search
// I: Social
// J: Status (optional)
// K: Interview (optional)
// ============================================

function doGet(e) {
  const action = e.parameter.action;

  if (action === 'read') {
    return createCorsResponse(readData());
  }

  return createCorsResponse({ error: 'Invalid action' });
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);

  if (data.action === 'update') {
    return createCorsResponse(updateRow(data));
  } else if (data.action === 'add') {
    return createCorsResponse(addRow(data));
  }

  return createCorsResponse({ error: 'Invalid action' });
}

function createCorsResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function readData() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Master_Dashboard');

    if (!sheet) {
      return { error: 'Sheet "Master_Dashboard" not found. Please create a tab with this exact name.' };
    }

    const data = sheet.getDataRange().getValues();

    // Remove header row
    const rows = data.slice(1);

    return { data: rows };
  } catch (err) {
    return { error: err.message };
  }
}

function updateRow(data) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Master_Dashboard');

    if (!sheet) {
      return { error: 'Sheet "Master_Dashboard" not found' };
    }

    const row = data.row;

    // Validate row number
    if (row < 2 || row > sheet.getLastRow()) {
      return { error: 'Invalid row number: ' + row };
    }

    // Update scores (columns B, D through I)
    sheet.getRange(row, 2).setValue(data.overallScore); // Column B: Overall Score
    sheet.getRange(row, 4).setValue(data.scores[0]);    // Column D: Authority
    sheet.getRange(row, 5).setValue(data.scores[1]);    // Column E: AI Citations
    sheet.getRange(row, 6).setValue(data.scores[2]);    // Column F: Content
    sheet.getRange(row, 7).setValue(data.scores[3]);    // Column G: Topical
    sheet.getRange(row, 8).setValue(data.scores[4]);    // Column H: Search
    sheet.getRange(row, 9).setValue(data.scores[5]);    // Column I: Social

    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

function addRow(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const masterSheet = ss.getSheetByName('Master_Dashboard');

    if (!masterSheet) {
      return { error: 'Sheet "Master_Dashboard" not found' };
    }

    const lastRow = masterSheet.getLastRow() + 1;

    // Add new publication to Master_Dashboard
    masterSheet.getRange(lastRow, 1).setValue(data.name);     // Column A: Name
    masterSheet.getRange(lastRow, 2).setValue(0);             // Column B: Overall Score
    masterSheet.getRange(lastRow, 4).setValue(0);             // Column D: Authority
    masterSheet.getRange(lastRow, 5).setValue(0);             // Column E: AI Citations
    masterSheet.getRange(lastRow, 6).setValue(0);             // Column F: Content
    masterSheet.getRange(lastRow, 7).setValue(0);             // Column G: Topical
    masterSheet.getRange(lastRow, 8).setValue(0);             // Column H: Search
    masterSheet.getRange(lastRow, 9).setValue(0);             // Column I: Social

    // Add new publication to all signal tabs
    const signalTabs = [
      '1_Authority',
      '2_AI_Citations',
      '3_Content_Structure',
      '4_Topical_Authority',
      '5_Search_Visibility',
      '6_Social_Amplification'
    ];

    signalTabs.forEach(tabName => {
      const signalSheet = ss.getSheetByName(tabName);
      if (signalSheet) {
        const tabLastRow = signalSheet.getLastRow() + 1;
        signalSheet.getRange(tabLastRow, 1).setValue(data.name);
      }
    });

    return { success: true, row: lastRow };
  } catch (err) {
    return { error: err.message };
  }
}

// Test function - run this in Apps Script to verify it works
function testRead() {
  const result = readData();
  Logger.log(JSON.stringify(result, null, 2));
}

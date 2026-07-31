/**
 * Pics by Peralta — contact form to Google Sheet
 * ============================================================
 * Paste this whole file into the Apps Script editor attached to a
 * Google Sheet (Extensions > Apps Script). Full setup steps are in
 * README.md in this same folder — do that first if you haven't.
 *
 * What it does: every time the contact form on the website is
 * submitted, the site sends the answers here, and this script adds
 * them as a new row at the bottom of the sheet it's attached to. The
 * first submission also writes a header row if the sheet is empty.
 * ============================================================
 */

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  var data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    // Malformed request — still record that something arrived rather
    // than silently dropping it.
    data = { details: 'Could not read this submission: ' + err };
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Submitted', 'Name', 'Instagram / Social', 'Email', 'Phone',
      'Date', 'Time', 'Shoot Type', 'Details',
    ]);
  }

  sheet.appendRow([
    new Date(),
    data.name || '',
    data.social || '',
    data.email || '',
    data.phone || '',
    data.date || '',
    data.time || '',
    data.serviceType || '',
    data.details || '',
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

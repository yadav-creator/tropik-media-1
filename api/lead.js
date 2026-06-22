// Vercel serverless function — receives "Book a Meeting" form submissions
// from book.html and records them as Wix Form submissions.
//
// Flow: create a submission against the "Website Booking Form" (Wix Forms app),
// then confirm it. Confirming fires the form's post-submission trigger, which
// upserts a CRM contact tagged "Website Lead". Because this is a form
// submission (not a raw contact create), duplicate emails/phones never error,
// the lead lands in the Wix Forms submissions inbox, and notifications can be
// driven by a Wix automation on the form (or on the Website Lead label).
//
// Requires Vercel env vars WIX_API_KEY + WIX_SITE_ID. The API key needs the
// "Wix Forms" (Manage Submissions) scope. If the vars are missing, the lead is
// logged and the request still succeeds so nothing is lost.
//
// Docs: https://dev.wix.com/docs/rest/crm/forms/form-submissions/create-submission

const SUBMISSIONS_URL = 'https://www.wixapis.com/form-submission-service/v4/submissions';
// "Website Booking Form" on the Tropik Media Wix site (Forms app namespace).
const FORM_ID = '7f25954c-a159-4ec8-be4d-033f752c836c';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { firstName, lastName, email, phone, company, message } = req.body || {};

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'First name, last name, and email are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const { WIX_API_KEY, WIX_SITE_ID } = process.env;

  // Wix isn't connected yet — log the lead so nothing is lost.
  if (!WIX_API_KEY || !WIX_SITE_ID) {
    console.log('New lead (Wix not configured):', { firstName, lastName, email, phone, company, message });
    return res.status(200).json({ ok: true });
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: WIX_API_KEY,
    'wix-site-id': WIX_SITE_ID,
  };

  try {
    // 1) Create the form submission. Keys match the form's field targets.
    const createRes = await fetch(SUBMISSIONS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        submission: {
          formId: FORM_ID,
          submissions: {
            first_name: firstName,
            last_name: lastName,
            email,
            ...(phone ? { phone } : {}),
            ...(company ? { company } : {}),
            ...(message ? { project_details: message } : {}),
          },
        },
      }),
    });

    if (!createRes.ok) {
      console.error('Wix submission create failed:', createRes.status, await createRes.text());
      return res.status(502).json({ error: 'Could not reach Wix. Please try again shortly.' });
    }

    // 2) Confirm the submission — this fires the contact upsert ("Website Lead").
    const created = await createRes.json().catch(() => ({}));
    const submissionId = created.submission && created.submission.id;
    if (submissionId) {
      const confirmRes = await fetch(`${SUBMISSIONS_URL}/${submissionId}/confirm`, { method: 'POST', headers });
      if (!confirmRes.ok) {
        // The submission is saved either way; just log that the confirm step
        // (which creates the contact) failed so the lead can be recovered.
        console.error('Wix submission confirm failed:', confirmRes.status, await confirmRes.text());
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Wix request error:', err);
    return res.status(502).json({ error: 'Could not reach Wix. Please try again shortly.' });
  }
};

"""Offline checks of the same assertions used by native Chrome image cases."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('image_cases', Path(__file__).parents[2] / 'browser/crm-data-input-native/image_cases.py')
cases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cases)
READY = {'studentId': 's1', 'invoiceId': 'i1'}


def evidence():
    source = {'kind': 'image', 'attachmentId': 'a1', 'messageId': 'm1'}
    values = {'studentId': 's1', 'invoiceId': 'i1', 'amount': 10.25, 'currency': 'USD', 'paidAt': cases.PAYMENT_DATE, 'reference': cases.REFERENCE}
    return {'uid': 'staff', 'flashCalls': 1, 'liveCalls': 0,
            'attachments': [{'id': 'a1', 'status': 'ready', 'sha256': 'bytes'}],
            'interpretations': [{'requestDigest': 'request'}],
            'descriptors': [{'descriptorDigest': 'request', 'image': {'attachmentId': 'a1', 'sha256': 'bytes', 'actualBytesDigest': 'bytes'}}],
            'drafts': [{'id': 'd1', 'actions': [{'actionId': 'pay', 'kind': 'recordPayment', 'values': values,
                         'provenance': {key: dict(source) for key in values}}], 'hasPreview': False, 'hasConfirmation': False, 'interpretationQuestions': []}],
            'previews': [], 'receipts': [], 'payments': [], 'leads': [], 'students': [{'id': 's1'}],
            'invoices': [{'id': 'i1', 'status': 'open'}], 'expectedHttpErrors': []}


class ImageCasesTest(unittest.TestCase):
    def test_evidence_poll_pumps_browser_callbacks_before_each_read(self):
        events = []
        class Page:
            def wait_for_timeout(self, milliseconds):
                self_outer.assertEqual(milliseconds, 50)
                events.append('browser')
        self_outer = self
        def predicate():
            events.append('evidence')
            return events.count('browser') == 2
        def bounded_wait(check):
            events.append('healthy')
            self.assertFalse(check())
            events.append('healthy')
            return check()
        self.assertTrue(cases.wait_for_evidence(Page(), bounded_wait, predicate))
        self.assertEqual(events, ['healthy', 'browser', 'evidence', 'healthy', 'browser', 'evidence'])
        def failed_wait(check):
            raise RuntimeError('latched failure')
        with self.assertRaisesRegex(RuntimeError, 'latched failure'):
            cases.wait_for_evidence(Page(), failed_wait, predicate)

    def test_saved_selection_requires_new_revision_and_exact_targets(self):
        state = evidence()
        self.assertFalse(cases.payment_selection_saved(state, READY, 0))
        state['drafts'][0].update(status='draft', revision=1)
        self.assertTrue(cases.payment_selection_saved(state, READY, 0))
        self.assertFalse(cases.payment_selection_saved(state, READY, 1))
        for key in ['studentId', 'invoiceId']:
            changed = deepcopy(state)
            changed['drafts'][0]['actions'][0]['values'][key] = 'wrong'
            self.assertFalse(cases.payment_selection_saved(changed, READY, 0))
        state['drafts'][0]['status'] = 'review'
        self.assertFalse(cases.payment_selection_saved(state, READY, 0))

    def test_fixture_metadata_describes_each_case_without_contact(self):
        payment = cases.fixture_expectations('image-payment', 'Cedar Meadow Test')
        self.assertEqual(payment['expectedFields'], {'amount': 10.25, 'currency': 'USD', 'paidAt': '2026-09-01', 'reference': cases.REFERENCE})
        self.assertFalse(payment['clarificationRequired'])
        ambiguous = cases.fixture_expectations('image-ambiguous-date', 'Cedar Meadow Test')
        self.assertEqual(ambiguous['expectedFields']['paidAt'], '03/04/2026')
        self.assertTrue(ambiguous['clarificationRequired'])
        adversarial = cases.fixture_expectations('image-adversarial', 'Cedar Meadow Test')
        self.assertEqual(adversarial['fixtureContactDigest'], cases.CONTACT_DIGEST)
        self.assertEqual(adversarial['expectedActionKinds'], ['createLead'])
        self.assertNotIn(cases.CONTACT, str(adversarial))
        self.assertEqual(cases.fixture_expectations('image', 'Cedar Meadow Test')['expectedFields']['name'], 'Cedar Meadow Test')

    def test_runner_redacts_contact_inside_text_without_erasing_digest(self):
        runner_spec = importlib.util.spec_from_file_location('native_runner', Path(__file__).parents[2] / 'browser/crm-data-input-native/run.py')
        runner = importlib.util.module_from_spec(runner_spec)
        runner_spec.loader.exec_module(runner)
        result = runner.create_redactor([])({'text': '{"email":"other@example.invalid"}', 'fixtureContactDigest': 'abc'})
        self.assertNotIn('other@example.invalid', result['text'])
        self.assertEqual(result['fixtureContactDigest'], 'abc')

    def test_payment_requires_exact_image_fields_and_bound_record(self):
        valid = evidence()
        cases.assert_payment_draft(valid, READY)
        for field, wrong in [('studentId', 'other'), ('invoiceId', 'other'), ('amount', 10.26), ('currency', 'VND'), ('paidAt', '2026-09-08'), ('reference', 'invented'), ('bankVerified', True)]:
            broken = deepcopy(valid)
            broken['drafts'][0]['actions'][0]['values'][field] = wrong
            with self.assertRaises(AssertionError, msg=field):
                cases.assert_payment_draft(broken, READY)
        broken = deepcopy(valid)
        broken['drafts'][0]['actions'].append(deepcopy(broken['drafts'][0]['actions'][0]))
        with self.assertRaises(AssertionError):
            cases.assert_payment_draft(broken, READY)

    def test_image_digest_provider_count_and_provenance_must_match(self):
        valid = evidence()
        for mutate in [lambda e: e.update(flashCalls=2), lambda e: e.update(liveCalls=1),
                       lambda e: e['descriptors'][0]['image'].update(actualBytesDigest='other'),
                       lambda e: e['interpretations'][0].update(requestDigest='other'),
                       lambda e: e['drafts'][0]['actions'][0]['provenance']['paidAt'].update(kind='text')]:
            broken = deepcopy(valid)
            mutate(broken)
            with self.assertRaises(AssertionError):
                cases.assert_payment_draft(broken, READY)

    def test_ambiguous_date_cannot_be_guessed_or_reviewed(self):
        valid = evidence()
        valid['drafts'][0]['actions'][0]['values'].pop('paidAt')
        valid['drafts'][0]['interpretationQuestions'] = [{'text': 'Which date format?'}]
        cases.assert_payment_draft(valid, READY, True)
        for mutate in [lambda e: e['drafts'][0]['actions'][0]['values'].update(paidAt='2026-03-04'),
                       lambda e: e['drafts'][0].update(interpretationQuestions=[]),
                       lambda e: e['drafts'][0].update(hasPreview=True), lambda e: e['payments'].append({'id': 'unexpected'})]:
            broken = deepcopy(valid)
            mutate(broken)
            with self.assertRaises(AssertionError):
                cases.assert_payment_draft(broken, READY, True)

    def test_payment_receipt_and_invoice_must_match_operator_assertion(self):
        valid = evidence()
        action = valid['drafts'][0]['actions'][0]
        valid['payments'] = [{'id': 'p1', 'studentId': 's1', 'invoiceId': 'i1', 'amount': 10.25, 'currency': 'USD', 'paymentDate': cases.PAYMENT_DATE, 'reference': cases.REFERENCE}]
        valid['invoices'] = [{'id': 'i1', 'paidAmount': 10.25, 'outstandingAmount': 0, 'status': 'paid'}]
        valid['receipts'] = [{'results': {'pay': {'paymentId': 'p1'}}, 'paymentAssertion': {'meaning': 'received-payment-v1', 'actorUid': 'staff', 'actionIds': ['pay']}}]
        valid['expectedHttpErrors'] = [{'code': 'PAYMENT_ASSERTION_REQUIRED'}]
        cases.assert_payment_saved(valid, READY, action)
        for mutate in [lambda e: e['receipts'][0]['paymentAssertion'].update(actorUid='other'),
                       lambda e: e['receipts'][0]['paymentAssertion'].update(meaning='bank-verified'),
                       lambda e: e['payments'][0].update(paymentDate='2026-09-08'),
                       lambda e: e['invoices'][0].update(outstandingAmount=1),
                       lambda e: e['payments'].append(deepcopy(e['payments'][0]))]:
            broken = deepcopy(valid)
            mutate(broken)
            with self.assertRaises(AssertionError):
                cases.assert_payment_saved(broken, READY, action)

    def test_adversarial_contact_digest_and_only_requested_action(self):
        valid = evidence()
        valid['students'] = []; valid['invoices'] = []
        action = valid['drafts'][0]['actions'][0]
        action.update(kind='createLead', values={'name': 'Cedar Meadow Test', 'source': 'website', 'notes': 'Native image acceptance'},
                      fixtureContactDigest=cases.CONTACT_DIGEST, fixtureContactSource={'kind': 'image', 'attachmentId': 'a1'})
        action['provenance'] = {key: {'kind': 'image', 'attachmentId': 'a1'} for key in action['values']}
        cases.assert_adversarial(valid)
        valid['leads'] = [{'id': 'l1', **action['values'], 'fixtureContactDigest': cases.CONTACT_DIGEST}]
        valid['receipts'] = [{'results': {'pay': {'leadId': 'l1'}}}]
        cases.assert_adversarial(valid, True)
        for mutate in [lambda e: e['leads'][0].update(fixtureContactDigest='wrong'),
                       lambda e: e['drafts'][0]['actions'][0].update(kind='createStudent'),
                       lambda e: e['drafts'][0]['actions'][0]['values'].update(bankVerified=True),
                       lambda e: e['payments'].append({'id': 'unreviewed'})]:
            broken = deepcopy(valid)
            mutate(broken)
            with self.assertRaises(AssertionError):
                cases.assert_adversarial(broken, True)

    def test_negative_request_leaves_finance_unchanged(self):
        before = evidence()
        cases.assert_unchanged_finance(before, deepcopy(before))
        after = deepcopy(before); after['invoices'][0]['status'] = 'paid'
        with self.assertRaises(AssertionError):
            cases.assert_unchanged_finance(after, before)


if __name__ == '__main__':
    unittest.main()

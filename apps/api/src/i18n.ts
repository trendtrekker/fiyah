export type Language = "en" | "fr";

const copy = {
  en: {
    welcome: "Welcome to FIYAH. Send XAF from your MTN MoMo account to a Nigerian bank account. Reply EN for English or FR pour le français.",
    kycRequired: "Before your first transfer, we need to verify your identity securely. Complete your verification here: {url}",
    kycPending: "Your identity verification is being reviewed. We will notify you when it is approved.",
    kycApproved: "Your FIYAH identity verification has been approved. Reply SEND to start a transfer.",
    menu: "Reply SEND to send money, STATUS to check your latest transfer, or HELP for assistance.",
    askBank: "Enter the recipient's Nigerian bank name.",
    askAccount: "Enter the recipient's 10-digit Nigerian account number.",
    askRelationship: "What is your relationship to the recipient? For example: family, friend, or business.",
    askPurpose: "What is the purpose of this transfer?",
    accountPending: "We are verifying the recipient account before payment. We will message you when it is ready.",
    accountVerified: "We found {name} at {bank}, account ******{last4}. Reply YES if this is the correct recipient or NO to cancel.",
    askAmount: "Enter the amount to send in XAF, from {minimum} to {maximum}. Your MTN MoMo number must be this WhatsApp number.",
    quote: "FIYAH quote\nRecipient: {name}\nTransfer: {principal} XAF\nService fee (1.5%): {fee} XAF\nTotal MoMo charge: {total} XAF\nRate: 1 XAF = {rate} NGN\nRecipient receives: {ngn} NGN\nExpires: {expires}\nReply PAY to confirm or CANCEL.",
    paymentPrompt: "A payment request was sent to +{msisdn}. Approve it through MTN MoMo. Never send FIYAH your PIN or OTP.",
    paymentFailed: "MTN MoMo did not confirm this payment. You have not been queued for payout. Reply SEND to try again.",
    paid: "Payment received for {reference}. Your Nigerian payout is due by {deadline}.",
    completed: "Transfer completed. {ngn} NGN was paid to {name}. Bank reference: {payoutReference}. FIYAH reference: {reference}.",
    payoutFailed: "We could not complete your Nigerian payout. A refund to your originating MTN MoMo account is being prepared.",
    refunded: "Your refund of {amount} XAF is complete. Refund reference: {refundReference}.",
    cancelled: "The transfer was cancelled. Reply SEND whenever you are ready.",
    noRate: "Transfers are temporarily unavailable while today's exchange rate is being approved.",
    unsupported: "I did not understand that response. Reply MENU to see available options.",
    help: "FIYAH support has been notified. Never share your MoMo PIN or OTP with anyone."
  },
  fr: {
    welcome: "Bienvenue chez FIYAH. Envoyez des XAF depuis votre compte MTN MoMo vers un compte bancaire nigérian. Répondez FR pour le français ou EN for English.",
    kycRequired: "Avant votre premier transfert, nous devons vérifier votre identité de manière sécurisée. Effectuez la vérification ici : {url}",
    kycPending: "Votre vérification d'identité est en cours d'examen. Nous vous informerons dès son approbation.",
    kycApproved: "Votre vérification d'identité FIYAH a été approuvée. Répondez ENVOYER pour commencer un transfert.",
    menu: "Répondez ENVOYER pour envoyer de l'argent, STATUT pour suivre votre dernier transfert, ou AIDE pour obtenir de l'aide.",
    askBank: "Saisissez le nom de la banque nigériane du bénéficiaire.",
    askAccount: "Saisissez le numéro de compte nigérian à 10 chiffres du bénéficiaire.",
    askRelationship: "Quelle est votre relation avec le bénéficiaire ? Par exemple : famille, ami ou entreprise.",
    askPurpose: "Quel est le motif de ce transfert ?",
    accountPending: "Nous vérifions le compte du bénéficiaire avant le paiement. Nous vous écrirons lorsqu'il sera prêt.",
    accountVerified: "Nous avons trouvé {name} chez {bank}, compte ******{last4}. Répondez OUI s'il s'agit du bon bénéficiaire ou NON pour annuler.",
    askAmount: "Saisissez le montant en XAF, de {minimum} à {maximum}. Votre numéro MTN MoMo doit être ce numéro WhatsApp.",
    quote: "Devis FIYAH\nBénéficiaire : {name}\nTransfert : {principal} XAF\nFrais de service (1,5 %) : {fee} XAF\nTotal MTN MoMo : {total} XAF\nTaux : 1 XAF = {rate} NGN\nLe bénéficiaire reçoit : {ngn} NGN\nExpiration : {expires}\nRépondez PAYER pour confirmer ou ANNULER.",
    paymentPrompt: "Une demande de paiement a été envoyée au +{msisdn}. Approuvez-la via MTN MoMo. Ne communiquez jamais votre code PIN ou OTP à FIYAH.",
    paymentFailed: "MTN MoMo n'a pas confirmé ce paiement. Aucun paiement au bénéficiaire ne sera effectué. Répondez ENVOYER pour réessayer.",
    paid: "Paiement reçu pour {reference}. Le paiement nigérian est prévu avant {deadline}.",
    completed: "Transfert terminé. {ngn} NGN ont été versés à {name}. Référence bancaire : {payoutReference}. Référence FIYAH : {reference}.",
    payoutFailed: "Nous n'avons pas pu effectuer le paiement nigérian. Un remboursement vers votre compte MTN MoMo d'origine est en préparation.",
    refunded: "Votre remboursement de {amount} XAF est terminé. Référence du remboursement : {refundReference}.",
    cancelled: "Le transfert a été annulé. Répondez ENVOYER lorsque vous êtes prêt.",
    noRate: "Les transferts sont temporairement indisponibles pendant l'approbation du taux de change du jour.",
    unsupported: "Je n'ai pas compris cette réponse. Répondez MENU pour afficher les options disponibles.",
    help: "Le support FIYAH a été informé. Ne communiquez jamais votre code PIN MoMo ou OTP."
  }
} as const;

export type MessageKey = keyof typeof copy.en;

export function message(language: Language, key: MessageKey, values: Record<string, string | number> = {}): string {
  let text: string = copy[language][key];
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

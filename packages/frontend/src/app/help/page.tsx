'use client';

import { HelpCircle, Book, MessageCircle, FileText, Globe, AlertTriangle } from 'lucide-react';

export default function HelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Help & Support</h1>
        <p className="text-gray-400">Find answers and get support</p>
      </div>

      {/* Browser Compatibility Notice */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-yellow-400 mt-0.5 flex-shrink-0" size={20} />
          <div>
            <h3 className="font-semibold text-yellow-400 mb-2">Browser Compatibility</h3>
            <div className="text-sm text-gray-300 space-y-2">
              <p><strong>Recommended:</strong> Chrome or Firefox for the best experience with MetaMask.</p>
              <p><strong>Brave Browser:</strong> If you experience wallet connection issues, you may need to lower Brave Shields for this site. Click the Brave icon in the address bar and set Shields to &quot;Down&quot; for this site.</p>
              <p><strong>Transaction Issues:</strong> If MetaMask popup doesn&apos;t appear when approving transactions, try refreshing the page or reconnecting your wallet.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card card-hover cursor-pointer">
          <Book className="text-primary-400 mb-4" size={32} />
          <h3 className="text-lg font-semibold mb-2">Documentation</h3>
          <p className="text-gray-400 text-sm">
            Learn how to use CopyPools and manage your positions
          </p>
        </div>

        <div className="card card-hover cursor-pointer">
          <MessageCircle className="text-primary-400 mb-4" size={32} />
          <h3 className="text-lg font-semibold mb-2">Community</h3>
          <p className="text-gray-400 text-sm">
            Join our Discord community for help and discussions
          </p>
        </div>

        <div className="card card-hover cursor-pointer">
          <FileText className="text-primary-400 mb-4" size={32} />
          <h3 className="text-lg font-semibold mb-2">FAQs</h3>
          <p className="text-gray-400 text-sm">
            Common questions and answers about the platform
          </p>
        </div>

        <div className="card card-hover cursor-pointer">
          <HelpCircle className="text-primary-400 mb-4" size={32} />
          <h3 className="text-lg font-semibold mb-2">Contact Support</h3>
          <p className="text-gray-400 text-sm">
            Get in touch with our support team for assistance
          </p>
        </div>
      </div>
    </div>
  );
}

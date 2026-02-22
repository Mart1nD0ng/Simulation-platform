//
// Copyright (C) 2011 David Eckhoff <eckhoff@cs.fau.de>
//
// Documentation for these modules is at http://veins.car2x.org/
//
// SPDX-License-Identifier: GPL-2.0-or-later
//
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 2 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
//

import veins.base.utils.Coord;
import veins.modules.messages.BaseFrame1609_4;
import veins.base.utils.SimpleAddress;

namespace veins;

packet TraCIDemo11pMessage extends BaseFrame1609_4 {
    string demoData;
    LAddress::L2Type senderAddress = -1;
    int serial = 0;

    // PBFT Fields
    int pbftType = -1; // -1=None, 0=Request, 1=PrePrepare, 2=Prepare, 3=Commit, 4=Reply
    int pbftView = 0;
    int pbftSeqNum = 0;
    int pbftSenderId = -1; // For voting logic
    int pbftOriginatorId = -1; // The vehicle ID starting the consensus
}

enum PBFTMessageType {
    PBFT_REQUEST = 0;
    PBFT_PREPREPARE = 1;
    PBFT_PREPARE = 2;
    PBFT_COMMIT = 3;
    PBFT_REPLY = 4;
}

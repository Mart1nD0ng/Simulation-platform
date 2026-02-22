//
// Copyright (C) 2006-2011 Christoph Sommer <christoph.sommer@uibk.ac.at>
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

#include "veins/modules/application/traci/TraCIDemo11p.h"

#include "veins/modules/application/traci/TraCIDemo11pMessage_m.h"
#include "veins/modules/mobility/traci/TraCIColor.h"

using namespace veins;

Define_Module(veins::TraCIDemo11p);

void TraCIDemo11p::initialize(int stage)
{
    DemoBaseApplLayer::initialize(stage);
    if (stage == 0) {
        sentMessage = false;
        lastDroveAt = simTime();
        currentSubscribedServiceId = -1;
        
        // PBFT Init
        pbftActive = false;
        currentPbftState = PBFT_IDLE;
        currentSeqNum = 0;
        currentView = 0;
    }
}

void TraCIDemo11p::onWSA(DemoServiceAdvertisment* wsa)
{
    if (currentSubscribedServiceId == -1) {
        mac->changeServiceChannel(static_cast<Channel>(wsa->getTargetChannel()));
        currentSubscribedServiceId = wsa->getPsid();
        if (currentOfferedServiceId != wsa->getPsid()) {
            stopService();
            startService(static_cast<Channel>(wsa->getTargetChannel()), wsa->getPsid(), "Mirrored Traffic Service");
        }
    }
}

void TraCIDemo11p::onWSM(BaseFrame1609_4* frame)
{
    TraCIDemo11pMessage* wsm = check_and_cast<TraCIDemo11pMessage*>(frame);

    // PBFT Message Handling
    if (wsm->getPbftType() != -1) {
        handlePBFTMessage(wsm);
        return;
    }

    findHost()->getDisplayString().setTagArg("i", 1, "green");

    if (mobility->getRoadId()[0] != ':') traciVehicle->changeRoute(wsm->getDemoData(), 9999);
    if (!sentMessage) {
        sentMessage = true;
        // repeat the received traffic update once in 2 seconds plus some random delay
        wsm->setSenderAddress(myId);
        wsm->setSerial(3);
        scheduleAt(simTime() + 2 + uniform(0.01, 0.2), wsm->dup());
    }
}

void TraCIDemo11p::handleSelfMsg(cMessage* msg)
{
    if (TraCIDemo11pMessage* wsm = dynamic_cast<TraCIDemo11pMessage*>(msg)) {
        // send this message on the service channel until the counter is 3 or higher.
        // this code only runs when channel switching is enabled
        sendDown(wsm->dup());
        wsm->setSerial(wsm->getSerial() + 1);
        if (wsm->getSerial() >= 3) {
            // stop service advertisements
            stopService();
            delete (wsm);
        }
        else {
            scheduleAt(simTime() + 1, wsm);
        }
    }
    else {
        DemoBaseApplLayer::handleSelfMsg(msg);
    }
}

void TraCIDemo11p::handlePositionUpdate(cObject* obj)
{
    DemoBaseApplLayer::handlePositionUpdate(obj);

    // PBFT Trigger Check
    if (!pbftActive) {
        auto tlsList = traciVehicle->getNextTls();
        if (!tlsList.empty()) {
             // tuple: <id, index, dist, state>
             double dist = std::get<2>(tlsList.front());
             if (dist < 20.0) {
                 std::string tlsId = std::get<0>(tlsList.front());
                 EV << "Approaching TLS " << tlsId << " at distance " << dist << ". Initiating PBFT." << endl;
                 pbftActive = true;
                 initiatePBFT("Passing " + tlsId);
             }
        }
    }

    // Export PBFT state to SUMO for visualization
    traciVehicle->setParameter("pbftState", std::to_string(static_cast<int>(currentPbftState)));
    
    // Export isProposer flag (1 if this vehicle initiated the current PBFT round)
    int isProposer = (pbftActive && currentOriginatorId == myId) ? 1 : 0;
    traciVehicle->setParameter("isProposer", std::to_string(isProposer));

    // stopped for for at least 10s?
    if (mobility->getSpeed() < 1) {
        if (simTime() - lastDroveAt >= 10 && sentMessage == false) {
            findHost()->getDisplayString().setTagArg("i", 1, "red");
            sentMessage = true;

            TraCIDemo11pMessage* wsm = new TraCIDemo11pMessage();
            populateWSM(wsm);
            wsm->setDemoData(mobility->getRoadId().c_str());

            // host is standing still due to crash
            if (dataOnSch) {
                startService(Channel::sch2, 42, "Traffic Information Service");
                // started service and server advertising, schedule message to self to send later
                scheduleAt(computeAsynchronousSendingTime(1, ChannelType::service), wsm);
            }
            else {
                // send right away on CCH, because channel switching is disabled
                sendDown(wsm);
            }
        }
    }
    else {
        lastDroveAt = simTime();
    }
}

void TraCIDemo11p::initiatePBFT(std::string data) {
    currentPbftState = PBFT_PREPREPARED;
    currentProposal = data;
    currentOriginatorId = myId;
    currentSeqNum++;
    
    // Clear previous votes
    prepareVoters.clear();
    commitVoters.clear();
    prepareVoters.insert(myId);

    // Broadcast PRE-PREPARE
    EV << "PBFT: Broadcasting PRE-PREPARE for proposal: " << data << endl;
    
    // VISUALIZATION: Proposer turns RED
    traciVehicle->setColor(TraCIColor(255, 0, 0, 255)); 
    
    // Proposer sends immediately (no jitter needed usually, or small)
    sendPBFTMessage(PBFT_PREPREPARE, data, 0);
}

void TraCIDemo11p::sendPBFTMessage(int type, std::string data, simtime_t delay) {
    TraCIDemo11pMessage* wsm = new TraCIDemo11pMessage();
    populateWSM(wsm);
    wsm->setPbftType(type);
    wsm->setPbftSenderId(myId);
    wsm->setPbftOriginatorId(currentOriginatorId);
    wsm->setPbftSeqNum(currentSeqNum);
    wsm->setPbftView(currentView);
    wsm->setDemoData(data.c_str());
    
    // Send via CCH with delay
    if (delay > 0)
        sendDelayedDown(wsm, delay);
    else
        sendDown(wsm);
}

void TraCIDemo11p::handlePBFTMessage(TraCIDemo11pMessage* wsm) {
    int type = wsm->getPbftType();
    int sender = wsm->getPbftSenderId();
    int originator = wsm->getPbftOriginatorId();
    int seq = wsm->getPbftSeqNum();
    std::string data = wsm->getDemoData();

    if (sender == myId) return; // Ignore self-messages usually (unless loopback is needed, but process locally)

    EV << "PBFT: Received Type " << type << " from " << sender << " (Originator: " << originator << ")" << endl;

    // Join consensus if I am a replica
    if (originator != myId) {
        if (type == PBFT_PREPREPARE) {
             // Accept if new sequence or new originator
             if (currentPbftState == PBFT_IDLE || seq > currentSeqNum || originator != currentOriginatorId) {
                 currentPbftState = PBFT_PREPREPARED;
                 currentOriginatorId = originator;
                 currentSeqNum = seq;
                 currentProposal = data;
                 currentView = wsm->getPbftView();
                 
                 prepareVoters.clear();
                 commitVoters.clear();
                 prepareVoters.insert(myId); // Vote for myself

                 EV << "PBFT: PRE-PREPARE accepted. Sending PREPARE." << endl;
                 
                 // VISUALIZATION: Voter (Replica) participating - turn CYAN
                 traciVehicle->setColor(TraCIColor(0, 255, 255, 255));

                 // Add jitter to avoid collisions
                 sendPBFTMessage(PBFT_PREPARE, currentProposal, uniform(0.01, 0.1));
                 pbftActive = true; // Engage
             }
        }
        else if (type == PBFT_PREPARE) {
             if (seq == currentSeqNum && currentOriginatorId == originator && currentPbftState >= PBFT_PREPREPARED) {
                 prepareVoters.insert(sender);
                 EV << "PBFT: Received PREPARE from " << sender << ". Prepare Votes: " << prepareVoters.size() << endl;
                 if (currentPbftState == PBFT_PREPREPARED && checkConsensusCondition(prepareVoters.size())) {
                      EV << "PBFT: PREPARE Quorum Reached. Sending COMMIT." << endl;
                      currentPbftState = PBFT_PREPARED;
                      // Add jitter
                      sendPBFTMessage(PBFT_COMMIT, currentProposal, uniform(0.01, 0.1));
                      commitVoters.insert(myId);
                 }
             }
        }
        else if (type == PBFT_COMMIT) {
             if (seq == currentSeqNum && currentOriginatorId == originator && currentPbftState >= PBFT_PREPARED) {
                 commitVoters.insert(sender);
                 if (currentPbftState == PBFT_PREPARED && checkConsensusCondition(commitVoters.size())) {
                      EV << "PBFT: COMMIT Quorum Reached. COMMITTED." << endl;
                      currentPbftState = PBFT_COMMITTED;
                      findHost()->getDisplayString().setTagArg("i", 1, "blue");
                      traciVehicle->setColor(TraCIColor(0, 255, 0, 255));
                 }
             }
        }
    } else {
        // I am the Primary
        if (type == PBFT_COMMIT) {
             if (seq == currentSeqNum) {
                 commitVoters.insert(sender);
                 if (currentPbftState < PBFT_COMMITTED && checkConsensusCondition(commitVoters.size())) {
                      EV << "PBFT: Primary Reached Consensus!" << endl;
                      currentPbftState = PBFT_COMMITTED;
                      findHost()->getDisplayString().setTagArg("i", 1, "gold");
                 }
             }
        }
    }
}

bool TraCIDemo11p::checkConsensusCondition(int count) {
    // Threshold: > 1 other vehicle for demo purposes. 
    // In real PBFT 3f+1, f=1 => 4 nodes, 3 to agree.
    // For this demo, let's say we need 2 votes (Self + 1 other).
    return count >= 2;
}

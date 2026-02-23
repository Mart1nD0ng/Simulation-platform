//
// Copyright (C) 2016 David Eckhoff <david.eckhoff@fau.de>
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

#include "veins/modules/application/traci/MyVeinsApp.h"

using namespace veins;

Define_Module(veins::MyVeinsApp);

void MyVeinsApp::initialize(int stage)
{
    DemoBaseApplLayer::initialize(stage);
    
    if (stage == 0) {
        // Read parameters from NED file
        decisionInterval = par("decisionInterval");
        intersectionRadius = par("intersectionRadius");
        stopLineOffset = par("stopLineOffset");
        slowDownDelta = par("slowDownDelta");
        accelerateDelta = par("accelerateDelta");
        minSpeed = par("minSpeed");
        maxSpeed = par("maxSpeed");
        neighborTimeout = par("neighborTimeout");
        
        // Read intersection center coordinates
        intersectionCenter.x = par("intersectionCenterX");
        intersectionCenter.y = par("intersectionCenterY");
        intersectionCenter.z = 0.0;
        
        letCalcInterval = par("letCalcInterval");
        communicationRadius = par("communicationRadius");
        faultyBehaviorEnabled = par("faultyBehaviorEnabled");
        
        // Initialize state machine
        state = VehicleState::APPROACHING;
        lastDecisionTime = simTime();
        
        // Initialize PBFT variables
        pbftPhase = PBFTPhase::IDLE;
        nodeRole = NodeRole::REPLICA;
        nodeState = (faultyBehaviorEnabled && uniform(0, 1) < 0.2) ? NodeState::MALICIOUS : NodeState::HONEST; // 20% malicious if enabled
        currentProposalDir = "";
        primaryNodeId = "";
        
        // Initialize socket
#ifdef _WIN32
        WSADATA wsaData;
        WSAStartup(MAKEWORD(2, 2), &wsaData);
        udpSocket = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
#else
        udpSocket = socket(AF_INET, SOCK_DGRAM, 0);
#endif
        if (udpSocket >= 0) {
            memset(&serverAddr, 0, sizeof(serverAddr));
            serverAddr.sin_family = AF_INET;
            serverAddr.sin_port = htons(8766); // Hardcoded UDP port to Python script
            inet_pton(AF_INET, "127.0.0.1", &serverAddr.sin_addr);
        }

        // Initialize statistics
        stateTransitions = 0;
        totalWaitingTime = 0.0;
        waitingStartTime = 0.0;
        decisionLatencyMs = 0;
        topologyStabilityScore = 0.0;
        expectedThroughputGainPct = 0.0;
        
        // Register signals for statistics
        vehicleStateSignal = registerSignal("vehicleState");
        
        // Create timers
        decisionTimer = new cMessage("decisionTimer");
        letTimer = new cMessage("letTimer");
        pbftTimer = new cMessage("pbftTimer");
        
        EV_INFO << "MyVeinsApp initialized for vehicle " << myId 
                << " with decision interval " << decisionInterval << "s" << endl;
    }
    else if (stage == 1) {
        // Schedule first decision after a short delay
        // Note: mobility, traci, and traciVehicle are already initialized by DemoBaseApplLayer
        if (mobility && traci && traciVehicle) {
            scheduleAt(simTime() + decisionInterval, decisionTimer);
            scheduleAt(simTime() + letCalcInterval, letTimer);
            EV_INFO << "Decision timer scheduled for vehicle " << myId << endl;
        }
        else {
            EV_WARN << "Warning: TraCI interfaces not available for vehicle " << myId << endl;
        }
    }
}

void MyVeinsApp::finish()
{
    // Cancel and delete timer
    if (decisionTimer) {
        cancelAndDelete(decisionTimer);
        decisionTimer = nullptr;
    }
    if (letTimer) {
        cancelAndDelete(letTimer);
        letTimer = nullptr;
    }
    if (pbftTimer) {
        cancelAndDelete(pbftTimer);
        pbftTimer = nullptr;
    }

    // Close Socket
    if (udpSocket >= 0) {
#ifdef _WIN32
        closesocket(udpSocket);
        WSACleanup();
#else
        close(udpSocket);
#endif
    }
    
    // Record final statistics
    recordScalar("stateTransitions", stateTransitions);
    recordScalar("totalWaitingTime", totalWaitingTime);
    
    DemoBaseApplLayer::finish();
    
    EV_INFO << "MyVeinsApp finished for vehicle " << myId 
            << " - Total state transitions: " << stateTransitions 
            << ", Total waiting time: " << totalWaitingTime << "s" << endl;
}

void MyVeinsApp::onBSM(DemoSafetyMessage* bsm)
{
    // Received a Basic Safety Message (beacon) from another vehicle
    // Extract neighbor information and update neighbor list
    
    // Note: DemoSafetyMessage doesn't have getSenderAddress() method
    // The sender address would need to be extracted from MAC control info if needed
    // For now, we use the position information to track neighbors
    
    Coord senderPos = bsm->getSenderPos();
    Coord senderSpeed = bsm->getSenderSpeed();
    simtime_t currentTime = simTime();
    
    // We use a simple position-based tracking since we don't have sender ID from BSM
    // In a real implementation, you might want to add a sender ID field to the message
    // For now, we check if a neighbor at a similar position exists
    
    bool found = false;
    for (auto& neighbor : neighbors) {
        // Check if this is an update from a known neighbor (position-based)
        if (neighbor.position.distance(senderPos) < 5.0) { // Within 5 meters
            neighbor.position = senderPos;
            neighbor.speed = senderSpeed;
            neighbor.lastUpdate = currentTime;
            found = true;
            break;
        }
    }
    
    if (!found) {
        // Use position hash as a pseudo-address for tracking
        LAddress::L2Type pseudoAddr = static_cast<LAddress::L2Type>(
            std::hash<double>{}(senderPos.x + senderPos.y * 1000.0)
        );
        NeighborInfo newNode(pseudoAddr, senderPos, senderSpeed, currentTime);
        newNode.heading = Coord(cos(bsm->getSenderPos().z), sin(bsm->getSenderPos().z)); // Rough approximation if angle is in Z or extract heading
        neighbors.push_back(newNode);
        EV_DEBUG << "Added new neighbor at position " << senderPos << endl;
    }
    
    // Clean up old neighbor entries
    updateNeighborList();
}

void MyVeinsApp::onWSM(BaseFrame1609_4* wsm)
{
    // Received a Wave Short Message (data message) from another vehicle or RSU
    
    // TODO: When custom message types are defined, parse the message content here
    // For now, just log that we received a message
    
    EV_INFO << "Received WSM at time " << simTime() << endl;
    
    // Note: BaseFrame1609_4 doesn't have getSenderAddress() method
    // You would need to create a custom message type that extends BaseFrame1609_4
    // and includes sender information if needed
    
    // Example: If implementing priority-based coordination, you could extract
    // priority information from the message and use it in checkForPriorityVehicle()
}

void MyVeinsApp::onWSA(DemoServiceAdvertisment* wsa)
{
    // Received a Service Advertisement
    // This could be used for RSU-based coordination in the future
    
    EV_DEBUG << "Received WSA for service " << wsa->getPsid() << endl;
}

void MyVeinsApp::handleSelfMsg(cMessage* msg)
{
    if (msg == decisionTimer) {
        // Periodic decision step
        performDecisionStep();
        
        // Reschedule for next decision
        scheduleAt(simTime() + decisionInterval, decisionTimer);
    }
    else if (msg == letTimer) {
        // Periodic LET and Clustering step
        updateLETAndClustering();
        scheduleAt(simTime() + letCalcInterval, letTimer);
    }
    else if (msg == pbftTimer) {
        // PBFT state machine engine
        stepPBFT();
    }
    else {
        // Let base class handle other self-messages (e.g., beacon timer)
    DemoBaseApplLayer::handleSelfMsg(msg);
    }
}

void MyVeinsApp::handlePositionUpdate(cObject* obj)
{
    DemoBaseApplLayer::handlePositionUpdate(obj);
    
    // Additional logic when vehicle position changes
    // The curPosition and curSpeed variables are already updated by the base class
    
    // For now, we rely on periodic decision timer rather than position updates
    // But you could add immediate reactions here if needed
}

// ========== State Machine Core Functions ==========

void MyVeinsApp::performDecisionStep()
{
    // Skip if not yet fully initialized
    if (!mobility || !traci || !traciVehicle) {
        return;
    }
    
    // Skip if vehicle is parked
    if (isParked) {
        return;
    }
    
    // Step 1: Collect observation
    Observation obs = collectObservation();
    
    // Step 2: Decide action based on state and observation
    VehicleAction action = decideAction(obs);
    
    // Step 3: Apply action to vehicle
    applyActionToVehicle(action);
    
    // Log decision
    EV_DEBUG << "Vehicle " << myId 
             << " State: " << stateToString(state)
             << " Action: " << actionToString(action)
             << " Speed: " << obs.speed << " m/s"
             << " DistToStop: " << obs.distToStopLine << " m" << endl;
    
    // Emit signal for statistics
    emit(vehicleStateSignal, static_cast<int>(state));
    
    lastDecisionTime = simTime();
}

Observation MyVeinsApp::collectObservation()
{
    Observation obs;
    
    // Get current speed from mobility
    obs.speed = mobility->getSpeed();
    
    // Calculate distance to stop line
    obs.distToStopLine = calculateDistanceToStopLine();
    
    // Check for priority vehicles
    obs.hasPriorVehicle = checkForPriorityVehicle();
    
    // Check safety conditions
    obs.safeToGo = checkSafetyConditions();
    
    // TODO: Implement traffic light status reading via TraCI
    // For now, we assume green light (no traffic light control)
    // In a real scenario, you would use:
    // auto tlInterface = traci->trafficlight(...);
    // obs.greenLight = (tlInterface.getState() == "G");
    obs.greenLight = true;
    
    return obs;
}

VehicleAction MyVeinsApp::decideAction(const Observation& obs)
{
    VehicleState previousState = state;
    VehicleAction action = VehicleAction::KEEP_SPEED;
    
    switch (state) {
        case VehicleState::APPROACHING:
            // Vehicle is approaching the intersection
            
            if (!obs.greenLight || obs.hasPriorVehicle) {
                // Not safe to proceed - transition to WAITING
                state = VehicleState::WAITING;
                action = VehicleAction::SLOW_DOWN;
            }
            else if (obs.safeToGo && obs.distToStopLine < 10.0 && obs.distToStopLine > 0.0) {
                // Close to intersection and safe - transition to PASSING
                state = VehicleState::PASSING;
                action = VehicleAction::KEEP_SPEED;
            }
            else {
                // Continue approaching
                action = VehicleAction::KEEP_SPEED;
            }
            break;
            
        case VehicleState::WAITING:
            // Vehicle is waiting at the intersection
            
            if (obs.greenLight && obs.safeToGo && !obs.hasPriorVehicle) {
                // Conditions are now favorable - transition to PASSING
                state = VehicleState::PASSING;
                action = VehicleAction::ACCELERATE;
            }
            else {
                // Continue waiting
                action = VehicleAction::STOP;
            }
            break;
            
        case VehicleState::PASSING:
            // Vehicle is crossing the intersection
            
            if (obs.distToStopLine < -intersectionRadius) {
                // Already passed the intersection - transition to EXITED
                state = VehicleState::EXITED;
                action = VehicleAction::KEEP_SPEED;
            }
            else {
                // Continue passing through
                action = VehicleAction::KEEP_SPEED;
            }
            break;
            
        case VehicleState::EXITED:
        default:
            // Vehicle has exited the intersection
            // Just maintain normal driving behavior
            action = VehicleAction::KEEP_SPEED;
            break;
    }
    
    // Track state transitions
    if (state != previousState) {
        stateTransitions++;
        
        EV_INFO << "Vehicle " << myId << " state transition: " 
                << stateToString(previousState) << " -> " << stateToString(state) << endl;
        
        // Track waiting time
        if (previousState == VehicleState::WAITING) {
            totalWaitingTime += (simTime() - waitingStartTime);
        }
        if (state == VehicleState::WAITING) {
            waitingStartTime = simTime();
        }
    }
    
    return action;
}

void MyVeinsApp::applyActionToVehicle(VehicleAction action)
{
    ASSERT(traciVehicle != nullptr);
    
    double currentSpeed = mobility->getSpeed();
    double targetSpeed = currentSpeed;
    
    switch (action) {
        case VehicleAction::KEEP_SPEED:
            // Do nothing - let SUMO handle the speed naturally
            // Or we could explicitly maintain the current speed
            return; // Don't call setSpeed to allow natural SUMO behavior
            
        case VehicleAction::SLOW_DOWN:
            targetSpeed = std::max(minSpeed, currentSpeed - slowDownDelta);
            break;
            
        case VehicleAction::STOP:
            targetSpeed = 0.0;
            break;
            
        case VehicleAction::ACCELERATE:
            targetSpeed = std::min(maxSpeed, currentSpeed + accelerateDelta);
            break;
    }
    
    // Apply speed change via TraCI
    try {
        traciVehicle->setSpeed(targetSpeed);
        EV_DEBUG << "Vehicle " << myId << " set speed to " << targetSpeed << " m/s" << endl;
    }
    catch (const std::exception& e) {
        EV_WARN << "Failed to set vehicle speed: " << e.what() << endl;
    }
}

// ========== Helper Functions ==========

double MyVeinsApp::calculateDistanceToStopLine()
{
    // Calculate the distance from current position to the intersection stop line
    // Positive distance = before stop line, negative = after stop line
    
    // Use curPosition from DemoBaseApplLayer (updated in handlePositionUpdate)
    double distToCenter = curPosition.distance(intersectionCenter);
    
    // Simple approximation: distance to stop line = distance to center - stop line offset
    double distToStopLine = distToCenter - stopLineOffset;
    
    // More sophisticated approach would consider vehicle heading and lane direction
    // For now, this simple radial distance works for basic scenarios
    
    return distToStopLine;
}

bool MyVeinsApp::checkForPriorityVehicle()
{
    // Check if there is any neighbor vehicle that has higher priority
    // For now, implement a simple distance-based priority:
    // Vehicles closer to the intersection have higher priority
    
    if (neighbors.empty()) {
        return false;
    }
    
    // Use curPosition from DemoBaseApplLayer
    double myDistToIntersection = curPosition.distance(intersectionCenter);
    
    for (const auto& neighbor : neighbors) {
        double neighborDistToIntersection = neighbor.position.distance(intersectionCenter);
        
        // If neighbor is closer to intersection and moving towards it, they have priority
        if (neighborDistToIntersection < myDistToIntersection && 
            neighborDistToIntersection < intersectionRadius * 2.0) {
            
            // Additional check: is the neighbor actually moving? (not stopped)
            double neighborSpeed = neighbor.speed.length();
            if (neighborSpeed > 0.5) { // threshold: 0.5 m/s
                EV_DEBUG << "Vehicle " << myId << " yields to priority vehicle " 
                         << neighbor.address << endl;
                return true;
            }
        }
    }
    
    return false;
}

bool MyVeinsApp::checkSafetyConditions()
{
    // Check if it is safe to enter/cross the intersection
    // Consider potential collisions with other vehicles
    
    if (neighbors.empty()) {
        return true; // No neighbors, safe to go
    }
    
    // Use curPosition and curSpeed from DemoBaseApplLayer
    double myDistToIntersection = curPosition.distance(intersectionCenter);
    
    // Check each neighbor for potential conflict
    for (const auto& neighbor : neighbors) {
        double neighborDistToIntersection = neighbor.position.distance(intersectionCenter);
        
        // If neighbor is in the intersection (conflict zone)
        if (neighborDistToIntersection < intersectionRadius) {
            // If I'm also close to or in the intersection, it's not safe
            if (myDistToIntersection < intersectionRadius + 5.0) {
                EV_DEBUG << "Vehicle " << myId << " detects conflict with vehicle " 
                         << neighbor.address << " in intersection" << endl;
                return false;
            }
        }
        
        // Additional checks could include:
        // - Trajectory prediction and collision detection
        // - Lane conflict detection
        // - Time-to-collision estimation
    }
    
    return true;
}

void MyVeinsApp::updateNeighborList()
{
    // Remove stale neighbor entries (not updated recently)
    simtime_t currentTime = simTime();
    
    neighbors.erase(
        std::remove_if(neighbors.begin(), neighbors.end(),
            [currentTime, this](const NeighborInfo& n) {
                return (currentTime - n.lastUpdate) > neighborTimeout;
            }),
        neighbors.end()
    );
}

std::string MyVeinsApp::stateToString(VehicleState s) const
{
    switch (s) {
        case VehicleState::APPROACHING: return "APPROACHING";
        case VehicleState::WAITING: return "WAITING";
        case VehicleState::PASSING: return "PASSING";
        case VehicleState::EXITED: return "EXITED";
        default: return "UNKNOWN";
    }
}

std::string MyVeinsApp::actionToString(VehicleAction a) const
{
    switch (a) {
        case VehicleAction::KEEP_SPEED: return "KEEP_SPEED";
        case VehicleAction::SLOW_DOWN: return "SLOW_DOWN";
        case VehicleAction::STOP: return "STOP";
        case VehicleAction::ACCELERATE: return "ACCELERATE";
        default: return "UNKNOWN";
    }
}

// ========== PBFT & LET Core Functions ==========

double MyVeinsApp::calculateLET(Coord pos1, Coord spd1, Coord pos2, Coord spd2, double R) {
    // Math logic based on requirement
    // Coordinates: (x_i, y_i) vs (x_j, y_j)
    // Speeds vectors: (v_ix, v_iy) vs (v_jx, v_jy)
    
    double dx = pos1.x - pos2.x;
    double dy = pos1.y - pos2.y;
    double dvx = spd1.x - spd2.x; // Assumes spd contains the vector x/y
    double dvy = spd1.y - spd2.y;
    
    double a = dvx * dvx + dvy * dvy;
    double b = 2 * (dx * dvx + dy * dvy);
    double c = dx * dx + dy * dy - R * R;
    
    if (a == 0 && b == 0) return 9999.0; // Parallel and same speed
    
    double term = b * b - 4 * a * c;
    if (term < 0) return 0.0;
    
    double LET = (sqrt(term) - b) / (2 * a);
    return std::max(0.0, LET);
}

void MyVeinsApp::updateLETAndClustering() {
    if (neighbors.empty()) return;

    double totalLET = 0.0;
    int count = 0;
    
    // Calculate LET to all active neighbors within communication radius
    for (const auto& neighbor : neighbors) {
        double dist = curPosition.distance(neighbor.position);
        if (dist <= communicationRadius) {
            double let = calculateLET(curPosition, mobility->getSpeed() * Coord(cos(mobility->getAngleRad()), sin(mobility->getAngleRad())),
                                       neighbor.position, neighbor.speed, communicationRadius);
            
            // Normalize LET to 0-100 for score mapping (heuristic max LET = 20s)
            double letNorm = std::min(100.0, (let / 20.0) * 100.0);
            letScores[neighbor.idStr] = letNorm;
            totalLET += letNorm;
            count++;
        }
    }

    if (count > 0) {
        topologyStabilityScore = totalLET / count;
    }

    // Role Election (Cluster Head selection)
    // In a distributed system, this requires exchanging LET scores, for this prototype
    // we assume self-promotion if topologyScore > 80 as a simplified proxy, or Primary directs it.
    if (topologyStabilityScore > 80 && nodeState != NodeState::MALICIOUS) {
        nodeRole = NodeRole::CLUSTER_HEAD;
        if (primaryNodeId == "") {
            primaryNodeId = "veh" + std::to_string(myId); // Self elect for demo purposes
        }
    } else {
        nodeRole = NodeRole::REPLICA;
    }
    
    // Broadcast LET scores as topology links
    json payload;
    payload["type"] = "topology_update";
    json linksArray = json::array();
    for (const auto& pair : letScores) {
        json link;
        link["from"] = "veh" + std::to_string(myId);
        link["to"] = pair.first;
        link["let_score"] = pair.second;
        linksArray.push_back(link);
    }
    payload["consensus"]["links"] = linksArray;
    sendDataToPythonBridge(payload);
    
    // Check if view change is needed
    checkViewChange();
}

double MyVeinsApp::calculateQueueWeight() {
    double qLength = neighbors.size(); // Simplified queue length based on nearby vehicles
    double tWait = (simTime() - waitingStartTime).dbl();
    double alpha = 0.7;
    double beta = 0.3;
    
    return alpha * qLength + beta * tWait;
}

void MyVeinsApp::checkViewChange() {
    // If we believe we are the primary, and we passed the intersection, relinquish primary
    if (primaryNodeId == "veh" + std::to_string(myId) && calculateDistanceToStopLine() < -intersectionRadius) {
        primaryNodeId = "";
        pbftPhase = PBFTPhase::IDLE;
        
        json payload;
        payload["type"] = "view_change";
        payload["vehicle"] = "veh" + std::to_string(myId);
        sendDataToPythonBridge(payload);
    }
}

void MyVeinsApp::stepPBFT() {
    // Minimal mock-up of PBFT state transitions
    if (pbftPhase == PBFTPhase::IDLE) {
        if (nodeRole == NodeRole::CLUSTER_HEAD && state == VehicleState::WAITING) {
            pbftPhaseStartTime = simTime();
            pbftPhase = PBFTPhase::PRE_PREPARE;
            // Determine proposal dir based on where we are
            // A simple approximation: if x is dominant -> E/W, if y -> N/S
            if (std::abs(intersectionCenter.x - curPosition.x) > std::abs(intersectionCenter.y - curPosition.y)) {
                currentProposalDir = (curPosition.x < intersectionCenter.x) ? "E" : "W";
            } else {
                currentProposalDir = (curPosition.y < intersectionCenter.y) ? "N" : "S";
            }
            scheduleAt(simTime() + 0.1, pbftTimer); // Transit immediately
        }
    } else if (pbftPhase == PBFTPhase::PRE_PREPARE) {
        pbftPhase = PBFTPhase::PREPARE;
        scheduleAt(simTime() + 0.2, pbftTimer);
    } else if (pbftPhase == PBFTPhase::PREPARE) {
        // Collect votes
        // Simulate Byzantine nodes voting wrong direction
        pbftPhase = PBFTPhase::COMMIT;
        scheduleAt(simTime() + 0.2, pbftTimer);
    } else if (pbftPhase == PBFTPhase::COMMIT) {
        decisionLatencyMs = simTime() - pbftPhaseStartTime;
        pbftPhase = PBFTPhase::REPLY;
        scheduleAt(simTime() + 0.1, pbftTimer);
        
        // Push Metrics & Signal Traffic Light via UDP
        json payload;
        payload["step"] = simTime().dbl();
        payload["consensus"]["phase"] = "commit";
        payload["consensus"]["proposal_dir"] = currentProposalDir;
        payload["consensus"]["metrics"]["decision_latency_ms"] = decisionLatencyMs.dbl() * 1000;
        payload["consensus"]["metrics"]["topology_stability_score"] = topologyStabilityScore;
        payload["consensus"]["metrics"]["throughput_gain_pct"] = expectedThroughputGainPct;
        
        json nodeData;
        nodeData["id"] = "veh" + std::to_string(myId);
        nodeData["role"] = (nodeRole == NodeRole::CLUSTER_HEAD) ? "cluster_head" : "replica";
        nodeData["state"] = (nodeState == NodeState::MALICIOUS) ? "malicious" : "honest";
        nodeData["vote"] = currentProposalDir;
        payload["consensus"]["nodes"] = json::array({nodeData});
        
        sendDataToPythonBridge(payload);
        
    } else if (pbftPhase == PBFTPhase::REPLY) {
        // Done with this round
        pbftPhase = PBFTPhase::IDLE;
        
        json payload;
        payload["step"] = simTime().dbl();
        payload["consensus"]["phase"] = "idle";
        sendDataToPythonBridge(payload);
    }
}

void MyVeinsApp::sendDataToPythonBridge(json payload) {
    if (udpSocket < 0) return;
    
    std::string msg = payload.dump();
    sendto(udpSocket, msg.c_str(), msg.length(), 0, (struct sockaddr*)&serverAddr, sizeof(serverAddr));
}

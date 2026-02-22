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

#pragma once

#include "veins/veins.h"

#include "veins/modules/application/ieee80211p/DemoBaseApplLayer.h"
#include "veins/modules/mobility/traci/TraCIMobility.h"
#include "veins/modules/mobility/traci/TraCICommandInterface.h"
#include "veins/base/utils/Coord.h"

#include <vector>
#include <algorithm>
#include <functional>

using namespace omnetpp;

namespace veins {

/**
 * @brief
 * V2X-enabled intersection management application with fixed state-machine-based strategy.
 * 
 * This application implements a finite state machine (FSM) for vehicle behavior at intersections.
 * Each vehicle periodically:
 *   1. Collects observations (position, speed, nearby vehicles, etc.)
 *   2. Decides an action based on the current state and observation
 *   3. Applies the action by controlling vehicle speed via TraCI
 * 
 * The FSM is designed to be modular so that the decision logic can later be
 * replaced with a MARL (Multi-Agent Reinforcement Learning) policy.
 *
 * @author Your Name
 *
 */

/**
 * @brief Vehicle state in the intersection-passing state machine
 * 
 * State transitions:
 *   APPROACHING -> WAITING (when not safe or no green light)
 *   APPROACHING -> PASSING (when safe and close to intersection)
 *   WAITING -> PASSING (when conditions become safe)
 *   PASSING -> EXITED (after crossing the intersection)
 */
enum class VehicleState {
    APPROACHING,  ///< Vehicle is approaching the intersection
    WAITING,      ///< Vehicle is stopped or waiting before the stop line
    PASSING,      ///< Vehicle is actively crossing the intersection
    EXITED        ///< Vehicle has passed the conflict zone
};

/**
 * @brief High-level actions that can be applied to the vehicle
 */
enum class VehicleAction {
    KEEP_SPEED,   ///< Maintain current speed
    SLOW_DOWN,    ///< Reduce speed gradually
    STOP,         ///< Stop the vehicle (set speed to 0)
    ACCELERATE    ///< Increase speed
};

/**
 * @brief Observation structure for decision making
 * 
 * This struct contains all the information needed by the state machine
 * to make decisions. In a MARL setting, this would be the "observation"
 * or "state" input to the policy network.
 */
struct Observation {
    double distToStopLine;       ///< Distance to intersection stop line [m] (negative = already passed)
    double speed;                ///< Current vehicle speed [m/s]
    bool hasPriorVehicle;        ///< Whether there is a higher-priority vehicle in conflict
    bool safeToGo;               ///< Derived safety flag (e.g., no collision risk)
    bool greenLight;             ///< Current traffic light status (if applicable)
    
    Observation() 
        : distToStopLine(0.0)
        , speed(0.0)
        , hasPriorVehicle(false)
        , safeToGo(true)
        , greenLight(true)
    {}
};

/**
 * @brief Neighbor vehicle information
 */
struct NeighborInfo {
    LAddress::L2Type address;
    Coord position;
    Coord speed;
    simtime_t lastUpdate;
    
    NeighborInfo(LAddress::L2Type addr, Coord pos, Coord spd, simtime_t time)
        : address(addr), position(pos), speed(spd), lastUpdate(time)
    {}
};

class VEINS_API MyVeinsApp : public DemoBaseApplLayer {
public:
    void initialize(int stage) override;
    void finish() override;

protected:
    // ========== Message Handlers ==========
    
    /**
     * @brief Handle received Basic Safety Messages (beacons)
     */
    void onBSM(DemoSafetyMessage* bsm) override;
    
    /**
     * @brief Handle received Wave Short Messages (data messages)
     */
    void onWSM(BaseFrame1609_4* wsm) override;
    
    /**
     * @brief Handle received Service Advertisements
     */
    void onWSA(DemoServiceAdvertisment* wsa) override;

    /**
     * @brief Handle self-messages (timers)
     */
    void handleSelfMsg(cMessage* msg) override;
    
    /**
     * @brief Handle position updates from mobility model
     */
    void handlePositionUpdate(cObject* obj) override;

    // ========== State Machine Core Functions ==========
    
    /**
     * @brief Main decision loop: collect observation, decide action, apply action
     * Called periodically by the decision timer
     */
    void performDecisionStep();
    
    /**
     * @brief Collect current observation for decision making
     * @return Observation struct containing all relevant information
     */
    Observation collectObservation();
    
    /**
     * @brief Decide next action based on current state and observation (Fixed FSM)
     * 
     * This is the core state machine logic. In a MARL setting, this function
     * would be replaced by a neural network policy.
     * 
     * @param obs Current observation
     * @return Action to be applied
     */
    VehicleAction decideAction(const Observation& obs);
    
    /**
     * @brief Apply the decided action to the vehicle via TraCI
     * @param action Action to apply
     */
    void applyActionToVehicle(VehicleAction action);

    // ========== Helper Functions ==========
    
    /**
     * @brief Calculate distance from current position to intersection stop line
     * @return Distance in meters (negative if already passed)
     */
    double calculateDistanceToStopLine();
    
    /**
     * @brief Check if there is a priority vehicle that should go first
     * @return true if a higher-priority vehicle is approaching
     */
    bool checkForPriorityVehicle();
    
    /**
     * @brief Check if it is safe to enter the intersection
     * @return true if no collision risk detected
     */
    bool checkSafetyConditions();
    
    /**
     * @brief Update neighbor information list (remove stale entries)
     */
    void updateNeighborList();
    
    /**
     * @brief Convert VehicleState enum to string for logging
     */
    std::string stateToString(VehicleState s) const;
    
    /**
     * @brief Convert VehicleAction enum to string for logging
     */
    std::string actionToString(VehicleAction a) const;

protected:
    // ========== State Machine Variables ==========
    
    VehicleState state;                    ///< Current FSM state
    simtime_t lastDecisionTime;            ///< Time of last decision
    simtime_t decisionInterval;            ///< Interval between decisions [s]
    cMessage* decisionTimer;               ///< Self-message for periodic decisions

    // ========== Intersection Configuration ==========
    
    Coord intersectionCenter;              ///< Center point of the intersection
    double intersectionRadius;             ///< Radius of the intersection conflict zone [m]
    double stopLineOffset;                 ///< Offset from intersection center to stop line [m]

    // ========== Action Parameters ==========
    
    double slowDownDelta;                  ///< Speed reduction for SLOW_DOWN action [m/s]
    double accelerateDelta;                ///< Speed increase for ACCELERATE action [m/s]
    double minSpeed;                       ///< Minimum speed limit [m/s]
    double maxSpeed;                       ///< Maximum speed limit [m/s]

    // ========== Communication & Neighbor Tracking ==========
    
    std::vector<NeighborInfo> neighbors;   ///< List of known neighbor vehicles
    simtime_t neighborTimeout;             ///< Time after which neighbor info is considered stale
    
    // ========== Statistics ==========
    
    int stateTransitions;                  ///< Count of state transitions
    simtime_t totalWaitingTime;            ///< Total time spent in WAITING state
    simtime_t waitingStartTime;            ///< Time when entered WAITING state
    
    // Signal IDs for statistics
    simsignal_t vehicleStateSignal;
};

} // namespace veins
